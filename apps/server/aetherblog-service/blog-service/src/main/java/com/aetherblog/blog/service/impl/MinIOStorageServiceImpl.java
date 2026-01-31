package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.blog.service.StorageService;
import com.aetherblog.common.core.exception.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.minio.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;


/**
 * MinIO存储服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Slf4j
@Service("minioStorageService")
@RequiredArgsConstructor
public class MinIOStorageServiceImpl implements StorageService {

    private final ObjectMapper objectMapper;

    @Override
    public UploadResult upload(MultipartFile file, StorageProvider provider, String path) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            MinioClient minioClient = createMinioClient(config);

            String bucket = config.get("bucket").asText();
            String key = path.startsWith("/") ? path.substring(1) : path;

            // 确保bucket存在
            ensureBucketExists(minioClient, bucket);

            // 上传文件
            minioClient.putObject(
                PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(key)
                    .stream(file.getInputStream(), file.getSize(), -1)
                    .contentType(file.getContentType())
                    .build()
            );

            String url = getUrl(path, provider);
            String cdnUrl = getCdnUrl(path, provider);

            log.info("MinIO存储上传成功: bucket={}, key={}, size={}", bucket, key, file.getSize());

            return new UploadResult(path, url, cdnUrl, file.getSize());

        } catch (Exception e) {
            log.error("MinIO存储上传失败: path={}", path, e);
            throw new BusinessException(500, "MinIO上传失败: " + e.getMessage());
        }
    }

    @Override
    public InputStream download(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            MinioClient minioClient = createMinioClient(config);

            String bucket = config.get("bucket").asText();
            String key = path.startsWith("/") ? path.substring(1) : path;

            return minioClient.getObject(
                GetObjectArgs.builder()
                    .bucket(bucket)
                    .object(key)
                    .build()
            );

        } catch (Exception e) {
            log.error("MinIO存储下载失败: path={}", path, e);
            throw new BusinessException(500, "MinIO下载失败: " + e.getMessage());
        }
    }

    @Override
    public void delete(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            MinioClient minioClient = createMinioClient(config);

            String bucket = config.get("bucket").asText();
            String key = path.startsWith("/") ? path.substring(1) : path;

            minioClient.removeObject(
                RemoveObjectArgs.builder()
                    .bucket(bucket)
                    .object(key)
                    .build()
            );

            log.info("MinIO存储删除成功: bucket={}, key={}", bucket, key);

        } catch (Exception e) {
            log.warn("MinIO存储删除失败: path={}", path, e);
        }
    }

    @Override
    public String getUrl(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            String endpoint = config.get("endpoint").asText();
            String bucket = config.get("bucket").asText();
            boolean useSSL = config.has("useSSL") && config.get("useSSL").asBoolean();

            String key = path.startsWith("/") ? path.substring(1) : path;
            String protocol = useSSL ? "https" : "http";

            return String.format("%s://%s/%s/%s", protocol, endpoint, bucket, key);

        } catch (IOException e) {
            log.error("解析MinIO配置失败", e);
            throw new BusinessException(500, "解析MinIO配置失败");
        }
    }

    @Override
    public String getCdnUrl(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());

            // 如果配置了CDN域名,使用CDN
            if (config.has("cdnDomain")) {
                String cdnDomain = config.get("cdnDomain").asText();
                String key = path.startsWith("/") ? path.substring(1) : path;
                return cdnDomain + "/" + key;
            }

            // 否则返回普通URL
            return getUrl(path, provider);

        } catch (IOException e) {
            log.error("解析MinIO配置失败", e);
            return getUrl(path, provider);
        }
    }

    @Override
    public boolean testConnection(StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            MinioClient minioClient = createMinioClient(config);

            String bucket = config.get("bucket").asText();

            // 测试bucket是否存在
            boolean exists = minioClient.bucketExists(
                BucketExistsArgs.builder()
                    .bucket(bucket)
                    .build()
            );

            return exists;

        } catch (Exception e) {
            log.error("MinIO连接测试失败", e);
            return false;
        }
    }

    /**
     * 创建MinIO客户端
     */
    private MinioClient createMinioClient(JsonNode config) {
        String endpoint = config.get("endpoint").asText();
        String accessKey = config.get("accessKey").asText();
        String secretKey = config.get("secretKey").asText();
        boolean useSSL = config.has("useSSL") && config.get("useSSL").asBoolean();

        return MinioClient.builder()
            .endpoint(endpoint, useSSL ? 443 : 9000, useSSL)
            .credentials(accessKey, secretKey)
            .build();
    }

    /**
     * 确保bucket存在,不存在则创建
     */
    private void ensureBucketExists(MinioClient minioClient, String bucket)
            throws Exception {
        boolean exists = minioClient.bucketExists(
            BucketExistsArgs.builder()
                .bucket(bucket)
                .build()
        );

        if (!exists) {
            minioClient.makeBucket(
                MakeBucketArgs.builder()
                    .bucket(bucket)
                    .build()
            );
            log.info("MinIO bucket创建成功: {}", bucket);
        }
    }
}
