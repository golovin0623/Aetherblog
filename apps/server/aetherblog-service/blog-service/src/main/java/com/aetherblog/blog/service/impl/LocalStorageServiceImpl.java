package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.blog.service.StorageService;
import com.aetherblog.common.core.exception.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 本地存储服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LocalStorageServiceImpl implements StorageService {

    private final ObjectMapper objectMapper;

    @Value("${aetherblog.upload.path:./uploads}")
    private String defaultBasePath;

    @Value("${aetherblog.upload.url-prefix:/uploads}")
    private String defaultUrlPrefix;

    /**
     * 安全解析和验证路径，防止目录遍历攻击 (Path Traversal)
     */
    private Path resolveAndValidatePath(String basePath, String path) {
        Path base = Paths.get(basePath).toAbsolutePath().normalize();
        Path resolved = base.resolve(path).toAbsolutePath().normalize();
        if (!resolved.startsWith(base)) {
            log.warn("检测到非法的路径访问尝试 (Path Traversal): basePath={}, path={}", basePath, path);
            throw new BusinessException(400, "非法的路径");
        }
        return resolved;
    }

    @Override
    public UploadResult upload(MultipartFile file, StorageProvider provider, String path) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            String basePath = config.has("basePath") ? config.get("basePath").asText() : defaultBasePath;
            String urlPrefix = config.has("urlPrefix") ? config.get("urlPrefix").asText() : defaultUrlPrefix;

            // 保存文件
            Path filePath = resolveAndValidatePath(basePath, path);

            // 创建目录
            Path uploadPath = filePath.getParent();
            if (uploadPath != null) {
                Files.createDirectories(uploadPath);
            }

            Files.copy(file.getInputStream(), filePath);

            String url = urlPrefix + "/" + path;
            log.info("本地存储上传成功: path={}, size={}", path, file.getSize());

            return new UploadResult(path, url, url, file.getSize());

        } catch (IOException e) {
            log.error("本地存储上传失败: path={}", path, e);
            throw new BusinessException(500, "文件上传失败: " + e.getMessage());
        }
    }

    @Override
    public InputStream download(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            String basePath = config.has("basePath") ? config.get("basePath").asText() : defaultBasePath;

            Path filePath = resolveAndValidatePath(basePath, path);
            if (!Files.exists(filePath)) {
                throw new BusinessException(404, "文件不存在: " + path);
            }

            return new FileInputStream(filePath.toFile());

        } catch (IOException e) {
            log.error("本地存储下载失败: path={}", path, e);
            throw new BusinessException(500, "文件下载失败: " + e.getMessage());
        }
    }

    @Override
    public void delete(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            String basePath = config.has("basePath") ? config.get("basePath").asText() : defaultBasePath;

            Path filePath = resolveAndValidatePath(basePath, path);
            Files.deleteIfExists(filePath);
            log.info("本地存储删除成功: path={}", path);

        } catch (IOException e) {
            log.warn("本地存储删除失败: path={}", path, e);
        }
    }

    @Override
    public String getUrl(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            String urlPrefix = config.has("urlPrefix") ? config.get("urlPrefix").asText() : defaultUrlPrefix;
            return urlPrefix + "/" + path;

        } catch (IOException e) {
            log.error("解析存储配置失败", e);
            return defaultUrlPrefix + "/" + path;
        }
    }

    @Override
    public String getCdnUrl(String path, StorageProvider provider) {
        // 本地存储无CDN,返回普通URL
        return getUrl(path, provider);
    }

    @Override
    public boolean testConnection(StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            String basePath = config.has("basePath") ? config.get("basePath").asText() : defaultBasePath;

            Path path = Paths.get(basePath);

            // 检查目录是否存在,不存在则创建
            if (!Files.exists(path)) {
                Files.createDirectories(path);
            }

            // 检查是否可写
            return Files.isWritable(path);

        } catch (Exception e) {
            log.error("本地存储连接测试失败", e);
            return false;
        }
    }
}
