package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 存储提供商实体
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Data
@Entity
@Table(name = "storage_providers", indexes = {
    @Index(name = "idx_storage_providers_default", columnList = "is_default"),
    @Index(name = "idx_storage_providers_enabled", columnList = "is_enabled")
})
public class StorageProvider {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 提供商名称
     */
    @Column(nullable = false, unique = true, length = 100)
    private String name;

    /**
     * 提供商类型
     */
    @Column(name = "provider_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private ProviderType providerType;

    /**
     * 配置JSON (存储endpoint, bucket, accessKey等)
     */
    @Column(name = "config_json", nullable = false, columnDefinition = "TEXT")
    private String configJson;

    /**
     * 是否为默认存储
     */
    @Column(name = "is_default", nullable = false)
    private Boolean isDefault = false;

    /**
     * 是否启用
     */
    @Column(name = "is_enabled", nullable = false)
    private Boolean isEnabled = true;

    /**
     * 优先级 (数字越大优先级越高)
     */
    @Column(nullable = false)
    private Integer priority = 0;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * 存储提供商类型枚举
     */
    public enum ProviderType {
        LOCAL,   // 本地存储
        S3,      // AWS S3
        MINIO,   // MinIO
        OSS,     // 阿里云OSS
        COS      // 腾讯云COS
    }
}
