package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.blog.service.StorageService;
import com.aetherblog.common.core.exception.BusinessException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;

/**
 * AWS S3存储服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Slf4j
@Service("s3StorageService")
@RequiredArgsConstructor
public class S3StorageServiceImpl implements StorageService {

    private final ObjectMapper objectMapper;

    @Override
    public UploadResult upload(MultipartFile file, StorageProvider provider, String path) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            S3Client s3Client = createS3Client(config);

            String bucket = config.get("bucket").asText();
            String key = path.startsWith("/") ? path.substring(1) : path;

            // 上传文件
            PutObjectRequest putRequest = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(file.getContentType())
                .contentLength(file.getSize())
                .build();

            s3Client.putObject(putRequest, RequestBody.fromInputStream(file.getInputStream(), file.getSize()));

            String url = getUrl(path, provider);
            String cdnUrl = getCdnUrl(path, provider);

            log.info("S3存储上传成功: bucket={}, key={}, size={}", bucket, key, file.getSize());

            return new UploadResult(path, url, cdnUrl, file.getSize());

        } catch (Exception e) {
            log.error("S3存储上传失败: path={}", path, e);
            throw new BusinessException(500, "S3上传失败: " + e.getMessage());
        }
    }

    @Override
    public InputStream download(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            S3Client s3Client = createS3Client(config);

            String bucket = config.get("bucket").asText();
            String key = path.startsWith("/") ? path.substring(1) : path;

            GetObjectRequest getRequest = GetObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .build();

            return s3Client.getObject(getRequest);

        } catch (Exception e) {
            log.error("S3存储下载失败: path={}", path, e);
            throw new BusinessException(500, "S3下载失败: " + e.getMessage());
        }
    }

    @Override
    public void delete(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            S3Client s3Client = createS3Client(config);

            String bucket = config.get("bucket").asText();
            String key = path.startsWith("/") ? path.substring(1) : path;

            DeleteObjectRequest deleteRequest = DeleteObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .build();

            s3Client.deleteObject(deleteRequest);
            log.info("S3存储删除成功: bucket={}, key={}", bucket, key);

        } catch (Exception e) {
            log.warn("S3存储删除失败: path={}", path, e);
        }
    }

    @Override
    public String getUrl(String path, StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            String bucket = config.get("bucket").asText();
            String region = config.has("region") ? config.get("region").asText() : "us-east-1";
            String endpoint = config.has("endpoint") ? config.get("endpoint").asText() : null;

            String key = path.startsWith("/") ? path.substring(1) : path;

            if (endpoint != null && !endpoint.isEmpty()) {
                // 自定义endpoint (如MinIO兼容模式)
                return endpoint + "/" + bucket + "/" + key;
            } else {
                // AWS S3标准URL
                return String.format("https://%s.s3.%s.amazonaws.com/%s", bucket, region, key);
            }

        } catch (IOException e) {
            log.error("解析S3配置失败", e);
            throw new BusinessException(500, "解析S3配置失败");
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
            log.error("解析S3配置失败", e);
            return getUrl(path, provider);
        }
    }

    @Override
    public boolean testConnection(StorageProvider provider) {
        try {
            JsonNode config = objectMapper.readTree(provider.getConfigJson());
            S3Client s3Client = createS3Client(config);

            String bucket = config.get("bucket").asText();

            // 测试bucket是否存在
            HeadBucketRequest headRequest = HeadBucketRequest.builder()
                .bucket(bucket)
                .build();

            s3Client.headBucket(headRequest);
            return true;

        } catch (Exception e) {
            log.error("S3连接测试失败", e);
            return false;
        }
    }

    /**
     * 创建S3客户端
     */
    private S3Client createS3Client(JsonNode config) {
        String accessKey = config.get("accessKey").asText();
        String secretKey = config.get("secretKey").asText();
        String region = config.has("region") ? config.get("region").asText() : "us-east-1";

        AwsBasicCredentials credentials = AwsBasicCredentials.create(accessKey, secretKey);

        var builder = S3Client.builder()
            .region(Region.of(region))
            .credentialsProvider(StaticCredentialsProvider.create(credentials));

        // 自定义endpoint (用于兼容MinIO等S3兼容存储)
        if (config.has("endpoint")) {
            String endpoint = config.get("endpoint").asText();
            builder.endpointOverride(URI.create(endpoint));
        }

        return builder.build();
    }
}
