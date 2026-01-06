package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaFile.FileType;
import com.aetherblog.blog.entity.MediaFile.StorageType;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.MediaFileRepository;
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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
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
    private final UserRepository userRepository;

    @Value("${aetherblog.upload.path:./uploads}")
    private String uploadBasePath;

    @Value("${aetherblog.upload.url-prefix:/uploads}")
    private String uploadUrlPrefix;

    private static final Set<String> ALLOWED_IMAGE_TYPES = Set.of(
            "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"
    );

    private static final Set<String> ALLOWED_VIDEO_TYPES = Set.of(
            "video/mp4", "video/webm", "video/ogg"
    );

    private static final Set<String> ALLOWED_AUDIO_TYPES = Set.of(
            "audio/mpeg", "audio/ogg", "audio/wav"
    );

    @Override
    @Transactional
    public MediaFile upload(MultipartFile file, Long uploaderId) {
        Objects.requireNonNull(file, "上传文件不能为空");
        if (file.isEmpty()) {
            throw new BusinessException(400, "上传文件不能为空");
        }

        String contentType = file.getContentType();
        FileType fileType = determineFileType(contentType);

        // 生成存储路径: /uploads/2026/01/06/uuid.ext
        String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM/dd"));
        String originalFilename = file.getOriginalFilename();
        String originalName = StringUtils.cleanPath(originalFilename != null ? originalFilename : "unknown");
        String extension = getFileExtension(originalName);
        String filename = UUID.randomUUID() + "." + extension;
        String relativePath = datePath + "/" + filename;

        try {
            // 创建目录
            Path uploadPath = Paths.get(uploadBasePath, datePath);
            Files.createDirectories(uploadPath);

            // 保存文件
            Path filePath = uploadPath.resolve(filename);
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

            log.info("上传文件成功: filename={}, size={}", filename, file.getSize());
            return mediaFileRepository.save(mediaFile);

        } catch (IOException e) {
            log.error("文件上传失败", e);
            throw new BusinessException(500, "文件上传失败: " + e.getMessage());
        }
    }

    @Override
    @Transactional
    public List<MediaFile> uploadBatch(List<MultipartFile> files, Long uploaderId) {
        Objects.requireNonNull(files, "文件列表不能为空");
        List<MediaFile> results = new ArrayList<>();
        for (MultipartFile file : files) {
            try {
                results.add(upload(file, uploaderId));
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
    public PageResult<MediaFile> listPage(FileType fileType, String keyword, int pageNum, int pageSize) {
        PageRequest pageRequest = PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<MediaFile> page;

        if (fileType != null) {
            page = mediaFileRepository.findByFileType(fileType, pageRequest);
        } else if (StringUtils.hasText(keyword)) {
            page = mediaFileRepository.searchByKeyword(keyword, pageRequest);
        } else {
            page = mediaFileRepository.findAll(pageRequest);
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
        Objects.requireNonNull(id, "文件ID不能为空");
        MediaFile mediaFile = getById(id);

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
        log.info("删除文件: id={}", id);
    }

    @Override
    @Transactional
    public void batchDelete(List<Long> ids) {
        Objects.requireNonNull(ids, "ID列表不能为空");
        if (ids.isEmpty()) {
            return;
        }
        for (Long id : ids) {
            if (id != null) {
                try {
                    delete(id);
                } catch (Exception e) {
                    log.warn("批量删除中单个文件失败: id={}, error={}", id, e.getMessage());
                }
            }
        }
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
    public MediaFile update(Long id, String altText, String originalName) {
        Objects.requireNonNull(id, "文件ID不能为空");
        MediaFile mediaFile = getById(id);
        if (altText != null) {
            mediaFile.setAltText(altText);
        }
        if (originalName != null) {
            mediaFile.setOriginalName(originalName);
        }
        return mediaFileRepository.save(mediaFile);
    }

    private FileType determineFileType(String contentType) {
        if (contentType == null) return FileType.OTHER;
        if (ALLOWED_IMAGE_TYPES.contains(contentType)) return FileType.IMAGE;
        if (ALLOWED_VIDEO_TYPES.contains(contentType)) return FileType.VIDEO;
        if (ALLOWED_AUDIO_TYPES.contains(contentType)) return FileType.AUDIO;
        if (contentType.startsWith("application/")) return FileType.DOCUMENT;
        return FileType.OTHER;
    }

    private String getFileExtension(String filename) {
        if (filename == null) return "bin";
        int dotIndex = filename.lastIndexOf('.');
        return dotIndex > 0 ? filename.substring(dotIndex + 1).toLowerCase() : "bin";
    }
}
