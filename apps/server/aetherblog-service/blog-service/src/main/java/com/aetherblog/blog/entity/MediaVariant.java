package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 媒体文件变体实体 (缩略图、格式转换等)
 *
 * @ref 媒体库深度优化方案 - Phase 4: 图像处理
 * @author AI Assistant
 * @since 2.4.0
 */
@Data
@Entity
@Table(name = "media_variants", indexes = {
    @Index(name = "idx_media_variants_file", columnList = "media_file_id"),
    @Index(name = "idx_media_variants_type", columnList = "variant_type")
}, uniqueConstraints = {
    @UniqueConstraint(name = "uq_media_variant", columnNames = {"media_file_id", "variant_type"})
})
public class MediaVariant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 所属媒体文件
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "media_file_id", nullable = false)
    private MediaFile mediaFile;

    /**
     * 变体类型
     */
    @Column(name = "variant_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private VariantType variantType;

    /**
     * 文件路径
     */
    @Column(name = "file_path", nullable = false, length = 500)
    private String filePath;

    /**
     * 访问URL
     */
    @Column(name = "file_url", nullable = false, length = 500)
    private String fileUrl;

    /**
     * 文件大小 (bytes)
     */
    @Column(name = "file_size", nullable = false)
    private Long fileSize;

    /**
     * 图片宽度
     */
    private Integer width;

    /**
     * 图片高度
     */
    private Integer height;

    /**
     * 图片格式
     */
    @Column(length = 20)
    private String format;

    /**
     * 压缩质量 (0-100)
     */
    private Integer quality;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    /**
     * 变体类型枚举
     */
    public enum VariantType {
        THUMBNAIL,  // 缩略图 (150x150)
        SMALL,      // 小图 (400x400)
        MEDIUM,     // 中图 (800x800)
        LARGE,      // 大图 (1600x1600)
        WEBP,       // WebP格式
        AVIF,       // AVIF格式
        ORIGINAL    // 原图备份
    }
}
