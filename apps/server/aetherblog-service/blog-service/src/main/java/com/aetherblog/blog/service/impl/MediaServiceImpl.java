package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaFile.FileType;
import com.aetherblog.blog.entity.MediaFile.StorageType;
import com.aetherblog.blog.entity.MediaFolder;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.MediaFileRepository;
import com.aetherblog.blog.repository.MediaFolderRepository;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.blog.service.MediaService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 媒体文件服务实现
 *
 * @author AI Assistant
 * @since 1.0.0
 * @ref §8.2-4 - 媒体管理模块
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MediaServiceImpl implements MediaService {

    private final MediaFileRepository mediaFileRepository;
    private final MediaFolderRepository mediaFolderRepository;
    private final UserRepository userRepository;

    @Value("${aetherblog.upload.path:./uploads}")
    private String uploadBasePath;

    @Value("${aetherblog.upload.url-prefix:/uploads}")
    private String uploadUrlPrefix;

    @Value("${aetherblog.media.trash-cleanup-days:120}")
    private int trashCleanupDays;

    // Security Note: SVG is removed to prevent Stored XSS attacks
    private static final Set<String> ALLOWED_IMAGE_TYPES = Set.of(
            "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/avif"
    );

    private static final Set<String> ALLOWED_VIDEO_TYPES = Set.of(
            "video/mp4", "video/webm", "video/ogg"
    );

    private static final Set<String> ALLOWED_AUDIO_TYPES = Set.of(
            "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-m4a", "audio/aac", "audio/flac"
    );

    // Security Note: XML is removed to prevent XSS/XXE risks
    private static final Set<String> DOCUMENT_EXTENSIONS = Set.of(
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "json", "log", "key", "pages", "numbers"
    );

    // Extensions that require magic byte validation
    private static final Set<String> CHECKED_IMAGE_EXTENSIONS = Set.of(
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "ico", "tiff"
    );

    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            // Images (SVG removed for security)
            "jpg", "jpeg", "png", "gif", "webp", "avif", "ico", "bmp", "tiff",
            // Video
            "mp4", "webm", "ogg", "avi", "mov", "wmv",
            // Audio
            "mp3", "wav", "m4a", "aac", "flac",
            // Documents (XML removed for security)
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "json", "log", "key", "pages", "numbers",
            // Archives
            "zip", "rar", "7z", "tar", "gz"
    );

    @Override
    @Transactional
    public MediaFile upload(MultipartFile file, Long uploaderId, Long folderId) {
        Objects.requireNonNull(file, "上传文件不能为空");
        if (file.isEmpty()) {
            throw new BusinessException(400, "上传文件不能为空");
        }

        String contentType = file.getContentType();
        String originalFilename = file.getOriginalFilename();
        FileType fileType = determineFileType(contentType, originalFilename);

        // 生成存储路径: /uploads/2026/01/06/uuid.ext
        String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM/dd"));
        String originalName = StringUtils.cleanPath(originalFilename != null ? originalFilename : "unknown");
        String extension = getFileExtension(originalName);

        // Security Check: Validate file extension
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            log.warn("拒绝上传非法文件类型: filename={}, extension={}", originalName, extension);
            throw new BusinessException(400, "不支持的文件类型: " + extension);
        }

        // Security Check: Validate Magic Bytes for images to prevent file disguise (e.g. PHP as PNG)
        validateMagicBytes(file, extension);

        String filename = UUID.randomUUID() + "." + extension;
        String relativePath = datePath + "/" + filename;

        MediaFolder folder = null;
        if (folderId != null) {
            folder = mediaFolderRepository.findById(folderId)
                    .orElseThrow(() -> new BusinessException(404, "目标文件夹不存在: " + folderId));
        }

        Path filePath = null;
        try {
            // 创建目录
            Path uploadPath = Paths.get(uploadBasePath, datePath);
            Files.createDirectories(uploadPath);

            // 保存文件
            filePath = uploadPath.resolve(filename);
            Files.copy(file.getInputStream(), filePath);

            // 构建实体
            MediaFile mediaFile = new MediaFile();
            mediaFile.setFilename(filename);
            mediaFile.setOriginalName(originalName);
            mediaFile.setFilePath(relativePath);
            mediaFile.setFileUrl(uploadUrlPrefix + "/" + relativePath);
            mediaFile.setFileSize(file.getSize());
            mediaFile.setMimeType(contentType != null ? contentType : "application/octet-stream");
            mediaFile.setFileType(fileType);
            mediaFile.setStorageType(StorageType.LOCAL);

            if (uploaderId != null) {
                User uploader = userRepository.findById(uploaderId).orElse(null);
                mediaFile.setUploader(uploader);
            }

            // @ref Phase 1: 设置文件夹关联
            if (folder != null) {
                mediaFile.setFolder(folder);
            }

            log.info("上传文件成功: filename={}, size={}, folderId={}", filename, file.getSize(), folderId);
            return mediaFileRepository.save(mediaFile);

        } catch (IOException e) {
            if (filePath != null) {
                try {
                    Files.deleteIfExists(filePath);
                } catch (IOException deleteException) {
                    log.warn("清理上传失败的文件失败: path={}, reason={}", filePath, deleteException.getMessage());
                }
            }
            log.error("文件上传失败", e);
            throw new BusinessException(500, "文件上传失败: " + e.getMessage());
        } catch (RuntimeException e) {
            if (filePath != null) {
                try {
                    Files.deleteIfExists(filePath);
                } catch (IOException deleteException) {
                    log.warn("清理上传失败的文件失败: path={}, reason={}", filePath, deleteException.getMessage());
                }
            }
            throw e;
        }
    }

    @Override
    @Transactional
    public List<MediaFile> uploadBatch(List<MultipartFile> files, Long uploaderId, Long folderId) {
        Objects.requireNonNull(files, "文件列表不能为空");
        List<MediaFile> results = new ArrayList<>();
        for (MultipartFile file : files) {
            try {
                results.add(upload(file, uploaderId, folderId));
            } catch (Exception e) {
                log.warn("批量上传中单个文件失败: {}", e.getMessage());
            }
        }
        return results;
    }

    @Override
    public MediaFile getById(Long id) {
        Objects.requireNonNull(id, "文件ID不能为空");
        return mediaFileRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文件不存在: " + id));
    }

    @Override
    public PageResult<MediaFile> listPage(String fileTypeStr, String keyword, Long folderId, int pageNum, int pageSize) {
        log.info("查询媒体列表: fileType={}, keyword={}, folderId={}, pageNum={}, pageSize={}",
                fileTypeStr, keyword, folderId, pageNum, pageSize);

        FileType fileType = null;
        if (StringUtils.hasText(fileTypeStr)) {
            try {
                fileType = FileType.valueOf(fileTypeStr.toUpperCase());
            } catch (IllegalArgumentException e) {
                log.warn("无效的文件类型参数: {}", fileTypeStr);
            }
        }

        PageRequest pageRequest = PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<MediaFile> page;

        boolean hasFileType = fileType != null;
        boolean hasKeyword = StringUtils.hasText(keyword);
        boolean hasFolderId = folderId != null;

        // @ref Phase 1: 支持按文件夹过滤
        if (hasFolderId) {
            if (hasFileType && hasKeyword) {
                // 文件夹 + 类型 + 关键词
                page = mediaFileRepository.findByFolderIdAndFileTypeAndKeyword(folderId, fileType, keyword, pageRequest);
            } else if (hasFileType) {
                // 文件夹 + 类型
                page = mediaFileRepository.findByFolderIdAndFileType(folderId, fileType, pageRequest);
            } else if (hasKeyword) {
                // 文件夹 + 关键词
                page = mediaFileRepository.findByFolderIdAndKeyword(folderId, keyword, pageRequest);
            } else {
                // 仅文件夹
                page = mediaFileRepository.findByFolderId(folderId, pageRequest);
            }
        } else {
            // 原有逻辑：不按文件夹过滤（排除已删除文件）
            if (hasFileType && hasKeyword) {
                page = mediaFileRepository.findByFileTypeAndKeyword(fileType, keyword, pageRequest);
            } else if (hasFileType) {
                page = mediaFileRepository.findByFileType(fileType, pageRequest);
            } else if (hasKeyword) {
                page = mediaFileRepository.searchByKeyword(keyword, pageRequest);
            } else {
                page = mediaFileRepository.findAllNotDeleted(pageRequest);
            }
        }

        return new PageResult<>(page.getContent(), page.getTotalElements(), pageNum, pageSize);
    }

    @Override
    public PageResult<MediaFile> listByUploader(Long uploaderId, int pageNum, int pageSize) {
        Objects.requireNonNull(uploaderId, "上传者ID不能为空");
        Page<MediaFile> page = mediaFileRepository.findByUploaderId(uploaderId,
                PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        return new PageResult<>(page.getContent(), page.getTotalElements(), pageNum, pageSize);
    }

    @Override
    @Transactional
    public void delete(Long id) {
        // 改为软删除（移入回收站）
        softDelete(id);
    }

    @Override
    @Transactional
    public void batchDelete(List<Long> ids) {
        // 改为批量软删除（移入回收站）
        batchSoftDelete(ids);
    }

    @Override
    public Map<String, Object> getStorageStats() {
        Map<String, Object> stats = new HashMap<>();
        Long totalSize = mediaFileRepository.getTotalStorageUsed();
        stats.put("totalSize", totalSize != null ? totalSize : 0L);
        stats.put("totalCount", mediaFileRepository.count());

        List<Object[]> typeCounts = mediaFileRepository.countByFileType();
        Map<String, Long> byType = new HashMap<>();
        if (typeCounts != null) {
            for (Object[] row : typeCounts) {
                if (row != null && row.length >= 2 && row[0] != null) {
                    byType.put(row[0].toString(), row[1] != null ? (Long) row[1] : 0L);
                }
            }
        }
        stats.put("byType", byType);

        return stats;
    }

    @Override
    @Transactional
    @SuppressWarnings("null")
    public MediaFile update(Long id, String altText, String originalName) {
        Objects.requireNonNull(id, "文件ID不能为空");
        MediaFile mediaFile = getById(id);
        if (altText != null) {
            mediaFile.setAltText(altText);
        }
        if (originalName != null) {
            mediaFile.setOriginalName(originalName);
        }
        return Objects.requireNonNull(mediaFileRepository.save(mediaFile), "保存媒体文件失败");
    }

    @Override
    @Transactional
    public MediaFile moveToFolder(Long id, Long folderId) {
        Objects.requireNonNull(id, "文件ID不能为空");
        MediaFile mediaFile = getById(id);

        if (folderId != null) {
            MediaFolder folder = mediaFolderRepository.findById(folderId)
                    .orElseThrow(() -> new BusinessException(404, "目标文件夹不存在: " + folderId));
            mediaFile.setFolder(folder);
        } else {
            // 移动到根目录
            mediaFile.setFolder(null);
        }

        log.info("移动文件: id={}, targetFolderId={}", id, folderId);
        return mediaFileRepository.save(mediaFile);
    }

    @Override
    @Transactional
    public void batchMoveToFolder(List<Long> ids, Long folderId) {
        Objects.requireNonNull(ids, "文件ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }

        MediaFolder folder = null;
        if (folderId != null) {
            folder = mediaFolderRepository.findById(folderId)
                    .orElseThrow(() -> new BusinessException(404, "目标文件夹不存在: " + folderId));
        }

        for (Long id : ids) {
            if (id != null) {
                try {
                    MediaFile mediaFile = getById(id);
                    mediaFile.setFolder(folder);
                    mediaFileRepository.save(mediaFile);
                } catch (Exception e) {
                    log.warn("批量移动中单个文件失败: id={}, error={}", id, e.getMessage());
                }
            }
        }
        log.info("批量移动文件: count={}, targetFolderId={}", ids.size(), folderId);
    }

    @Override
    @Transactional
    public void softDelete(Long id) {
        Objects.requireNonNull(id, "文件ID不能为空");
        MediaFile mediaFile = getById(id);
        mediaFile.setDeleted(true);
        mediaFile.setDeletedAt(LocalDateTime.now());
        mediaFileRepository.save(mediaFile);
        log.info("软删除文件（移入回收站）: id={}", id);
    }

    @Override
    @Transactional
    public void batchSoftDelete(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        for (Long id : ids) {
            if (id != null) {
                try {
                    softDelete(id);
                } catch (Exception e) {
                    log.warn("批量软删除中单个文件失败: id={}, error={}", id, e.getMessage());
                }
            }
        }
        log.info("批量软删除文件: count={}", ids.size());
    }

    @Override
    public PageResult<MediaFile> listTrash(int pageNum, int pageSize) {
        PageRequest pageRequest = PageRequest.of(pageNum - 1, pageSize);
        Page<MediaFile> page = mediaFileRepository.findAllDeleted(pageRequest);
        return new PageResult<>(page.getContent(), page.getTotalElements(), pageNum, pageSize);
    }

    @Override
    @Transactional
    public MediaFile restore(Long id) {
        Objects.requireNonNull(id, "文件ID不能为空");
        MediaFile mediaFile = mediaFileRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文件不存在: " + id));

        if (!Boolean.TRUE.equals(mediaFile.getDeleted())) {
            throw new BusinessException(400, "文件不在回收站中");
        }

        mediaFile.setDeleted(false);
        mediaFile.setDeletedAt(null);
        log.info("从回收站恢复文件: id={}", id);
        return mediaFileRepository.save(mediaFile);
    }

    @Override
    @Transactional
    public void batchRestore(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        for (Long id : ids) {
            if (id != null) {
                try {
                    restore(id);
                } catch (Exception e) {
                    log.warn("批量恢复中单个文件失败: id={}, error={}", id, e.getMessage());
                }
            }
        }
        log.info("批量恢复文件: count={}", ids.size());
    }

    @Override
    @Transactional
    public void permanentDelete(Long id) {
        Objects.requireNonNull(id, "文件ID不能为空");
        MediaFile mediaFile = mediaFileRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文件不存在: " + id));

        // 删除物理文件
        try {
            String filePath = mediaFile.getFilePath();
            if (filePath != null) {
                Path path = Paths.get(uploadBasePath, filePath);
                Files.deleteIfExists(path);
            }
        } catch (IOException e) {
            log.warn("删除物理文件失败: {}", e.getMessage());
        }

        mediaFileRepository.deleteById(id);
        log.info("彻底删除文件: id={}", id);
    }

    @Override
    @Transactional
    public void batchPermanentDelete(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        for (Long id : ids) {
            if (id != null) {
                try {
                    permanentDelete(id);
                } catch (Exception e) {
                    log.warn("批量彻底删除中单个文件失败: id={}, error={}", id, e.getMessage());
                }
            }
        }
        log.info("批量彻底删除文件: count={}", ids.size());
    }

    @Override
    @Transactional
    public void emptyTrash() {
        List<MediaFile> deletedFiles = mediaFileRepository.findAllDeleted(PageRequest.of(0, Integer.MAX_VALUE)).getContent();
        for (MediaFile mediaFile : deletedFiles) {
            try {
                permanentDelete(mediaFile.getId());
            } catch (Exception e) {
                log.warn("清空回收站时删除文件失败: id={}, error={}", mediaFile.getId(), e.getMessage());
            }
        }
        log.info("清空回收站: count={}", deletedFiles.size());
    }

    @Override
    public long getTrashCount() {
        return mediaFileRepository.countDeleted();
    }

    /**
     * 自动清理回收站任务
     * 每天凌晨 2 点执行
     */
    @Scheduled(cron = "0 0 2 * * ?")
    @Transactional
    public void autoCleanupTrash() {
        log.info("开始执行回收站自动清理任务 (保留天数: {})...", trashCleanupDays);
        LocalDateTime cutoffTime = LocalDateTime.now().minusDays(trashCleanupDays);
        List<MediaFile> expiredFiles = mediaFileRepository.findDeletedBefore(cutoffTime);

        if (!expiredFiles.isEmpty()) {
            log.info("发现 {} 个已过期文件，准备彻底删除", expiredFiles.size());
            for (MediaFile file : expiredFiles) {
                try {
                    permanentDelete(file.getId());
                } catch (Exception e) {
                    log.error("自动清理文件失败: id={}, error={}", file.getId(), e.getMessage());
                }
            }
            log.info("回收站自动清理任务完成");
        } else {
            log.info("没有发现过期的已删除文件");
        }
    }

    private FileType determineFileType(String contentType, String originalFilename) {
        if (contentType == null) return FileType.OTHER;
        if (ALLOWED_IMAGE_TYPES.contains(contentType)) return FileType.IMAGE;
        if (ALLOWED_VIDEO_TYPES.contains(contentType)) return FileType.VIDEO;
        if (ALLOWED_AUDIO_TYPES.contains(contentType)) return FileType.AUDIO;
        if (contentType.startsWith("application/") || contentType.startsWith("text/")) {
            // 检查可能是 text/* 或 application/* 的特定文档类型的扩展名
            String extension = getFileExtension(originalFilename);
            if (DOCUMENT_EXTENSIONS.contains(extension)) {
                return FileType.DOCUMENT;
            }
            // 标准应用程序类型 (pdf, office 等) 的回退
            if (contentType.startsWith("application/") && !contentType.equals("application/octet-stream")) {
                return FileType.DOCUMENT;
            }
        }

        // 最后检查扩展名，以防 MIME 类型是通用二进制
        String extension = getFileExtension(originalFilename);
        if (DOCUMENT_EXTENSIONS.contains(extension)) {
            return FileType.DOCUMENT;
        }

        return FileType.OTHER;
    }

    private String getFileExtension(String filename) {
        if (filename == null) return "bin";
        int dotIndex = filename.lastIndexOf('.');
        return dotIndex > 0 ? filename.substring(dotIndex + 1).toLowerCase() : "bin";
    }

    private void validateMagicBytes(MultipartFile file, String extension) {
        if (!CHECKED_IMAGE_EXTENSIONS.contains(extension)) {
            return;
        }

        try (java.io.InputStream is = file.getInputStream()) {
            byte[] header = new byte[12];
            int read = is.read(header);

            if (read < 2) {
                 throw new BusinessException(400, "文件内容为空或过短");
            }

            // WebP requires at least 12 bytes to check RIFF....WEBP
            if ("webp".equals(extension) && read < 12) {
                 throw new BusinessException(400, "WebP文件损坏或无效");
            }

            String hex = bytesToHex(header);
            boolean isValid = false;

            switch (extension) {
                case "jpg":
                case "jpeg":
                    isValid = hex.startsWith("FFD8FF");
                    break;
                case "png":
                    isValid = hex.startsWith("89504E470D0A1A0A");
                    break;
                case "gif":
                    isValid = hex.startsWith("47494638");
                    break;
                case "webp":
                    // 0-3: 52 49 46 46 (RIFF)
                    // 8-11: 57 45 42 50 (WEBP)
                    isValid = hex.startsWith("52494646") && hex.substring(16, 24).equals("57454250");
                    break;
                case "bmp":
                    isValid = hex.startsWith("424D");
                    break;
                case "avif":
                    // AVIF uses ftyp box, usually starts with ....ftypavif (bytes 4-11)
                    // Since offset 4 is variable, we check 000000..6674797061766966 or similar
                    // But typically: 00 00 00 1C 66 74 79 70 61 76 69 66 (ftypavif)
                    // Check for "ftyp" at offset 4: 66747970
                    isValid = hex.substring(8, 16).equals("66747970");
                    break;
                case "ico":
                    isValid = hex.startsWith("00000100");
                    break;
                case "tiff":
                    isValid = hex.startsWith("49492A00") || hex.startsWith("4D4D002A");
                    break;
                default:
                    // Default to false for security; any checked extension must have a case here
                    isValid = false;
            }

            if (!isValid) {
                 log.warn("文件魔数校验失败: extension={}, hex={}", extension, hex);
                 throw new BusinessException(400, "文件内容与扩展名不匹配，请检查文件完整性");
            }
        } catch (IOException e) {
            log.error("无法读取文件头", e);
            throw new BusinessException(500, "无法验证文件内容");
        }
    }

    private static final char[] HEX_ARRAY = "0123456789ABCDEF".toCharArray();
    private static String bytesToHex(byte[] bytes) {
        char[] hexChars = new char[bytes.length * 2];
        for (int j = 0; j < bytes.length; j++) {
            int v = bytes[j] & 0xFF;
            hexChars[j * 2] = HEX_ARRAY[v >>> 4];
            hexChars[j * 2 + 1] = HEX_ARRAY[v & 0x0F];
        }
        return new String(hexChars);
    }
}
