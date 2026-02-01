package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaVersion;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.MediaFileRepository;
import com.aetherblog.blog.repository.MediaVersionRepository;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.blog.service.VersionService;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
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
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * 版本控制服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VersionServiceImpl implements VersionService {

    private final MediaVersionRepository versionRepository;
    private final MediaFileRepository fileRepository;
    private final UserRepository userRepository;

    @Value("${aetherblog.upload.path:./uploads}")
    private String uploadBasePath;

    @Value("${aetherblog.upload.url-prefix:/uploads}")
    private String uploadUrlPrefix;

    @Override
    @Transactional
    public MediaVersion createVersion(Long fileId, MultipartFile newFile, String description, Long userId) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        Objects.requireNonNull(newFile, "新文件不能为空");

        MediaFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new BusinessException(404, "文件不存在"));

        // 获取下一个版本号
        Integer nextVersion = getLatestVersionNumber(fileId) + 1;

        try {
            // 生成版本文件路径
            String datePath = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy/MM/dd"));
            String originalName = StringUtils.cleanPath(newFile.getOriginalFilename() != null ?
                    newFile.getOriginalFilename() : "unknown");
            String extension = getFileExtension(originalName);
            String filename = UUID.randomUUID() + "_v" + nextVersion + "." + extension;
            String relativePath = "versions/" + datePath + "/" + filename;

            // 创建目录
            Path uploadPath = Paths.get(uploadBasePath, "versions", datePath);
            Files.createDirectories(uploadPath);

            // 保存文件
            Path filePath = uploadPath.resolve(filename);
            Files.copy(newFile.getInputStream(), filePath);

            // 创建版本实体
            MediaVersion version = new MediaVersion();
            version.setMediaFile(file);
            version.setVersionNumber(nextVersion);
            version.setFilePath(relativePath);
            version.setFileUrl(uploadUrlPrefix + "/" + relativePath);
            version.setFileSize(newFile.getSize());
            version.setChangeDescription(description);

            if (userId != null) {
                User user = userRepository.findById(userId).orElse(null);
                version.setCreatedBy(user);
            }

            MediaVersion saved = versionRepository.save(version);
            log.info("创建版本: fileId={}, version={}, size={}", fileId, nextVersion, newFile.getSize());
            return saved;

        } catch (IOException e) {
            log.error("创建版本失败: fileId={}", fileId, e);
            throw new BusinessException(500, "创建版本失败: " + e.getMessage());
        }
    }

    @Override
    public List<MediaVersion> getVersionHistory(Long fileId) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        return versionRepository.findByMediaFileIdOrderByVersionNumberDesc(fileId);
    }

    @Override
    public MediaVersion getVersion(Long fileId, Integer versionNumber) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        Objects.requireNonNull(versionNumber, "版本号不能为空");
        return versionRepository.findByMediaFileIdAndVersionNumber(fileId, versionNumber)
                .orElseThrow(() -> new BusinessException(404, "版本不存在"));
    }

    @Override
    @Transactional
    public MediaFile restoreVersion(Long fileId, Integer versionNumber, Long userId) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        Objects.requireNonNull(versionNumber, "版本号不能为空");

        MediaFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new BusinessException(404, "文件不存在"));

        MediaVersion version = getVersion(fileId, versionNumber);

        try {
            // 备份当前文件为新版本
            Path currentPath = Paths.get(uploadBasePath, file.getFilePath());
            if (Files.exists(currentPath)) {
                // TODO: 可选 - 将当前文件保存为新版本
            }

            // 复制版本文件到当前位置
            Path versionPath = Paths.get(uploadBasePath, version.getFilePath());
            if (!Files.exists(versionPath)) {
                throw new BusinessException(404, "版本文件不存在");
            }

            Files.copy(versionPath, currentPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);

            // 更新文件大小
            file.setFileSize(version.getFileSize());
            MediaFile updated = fileRepository.save(file);

            log.info("恢复版本: fileId={}, version={}", fileId, versionNumber);
            return updated;

        } catch (IOException e) {
            log.error("恢复版本失败: fileId={}, version={}", fileId, versionNumber, e);
            throw new BusinessException(500, "恢复版本失败: " + e.getMessage());
        }
    }

    @Override
    @Transactional
    public void deleteVersion(Long versionId) {
        Objects.requireNonNull(versionId, "版本ID不能为空");
        MediaVersion version = versionRepository.findById(versionId)
                .orElseThrow(() -> new BusinessException(404, "版本不存在"));

        // 删除物理文件
        try {
            Path path = Paths.get(uploadBasePath, version.getFilePath());
            Files.deleteIfExists(path);
        } catch (IOException e) {
            log.warn("删除版本文件失败: path={}", version.getFilePath(), e);
        }

        versionRepository.deleteById(versionId);
        log.info("删除版本: versionId={}", versionId);
    }

    @Override
    @Transactional
    public void deleteAllVersions(Long fileId) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        List<MediaVersion> versions = versionRepository.findByMediaFileIdOrderByVersionNumberDesc(fileId);

        // 删除物理文件
        for (MediaVersion version : versions) {
            try {
                Path path = Paths.get(uploadBasePath, version.getFilePath());
                Files.deleteIfExists(path);
            } catch (IOException e) {
                log.warn("删除版本文件失败: path={}", version.getFilePath(), e);
            }
        }

        versionRepository.deleteByMediaFileId(fileId);
        log.info("删除所有版本: fileId={}, count={}", fileId, versions.size());
    }

    @Override
    public Integer getLatestVersionNumber(Long fileId) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        return versionRepository.getLatestVersionNumber(fileId).orElse(0);
    }

    // ========== 辅助方法 ==========

    private String getFileExtension(String filename) {
        if (filename == null) return "bin";
        int dotIndex = filename.lastIndexOf('.');
        return dotIndex > 0 ? filename.substring(dotIndex + 1).toLowerCase() : "bin";
    }
}
