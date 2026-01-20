package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 媒体版本实体
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Data
@Entity
@Table(name = "media_versions", indexes = {
    @Index(name = "idx_media_versions_file", columnList = "media_file_id"),
    @Index(name = "idx_media_versions_created", columnList = "created_at")
}, uniqueConstraints = {
    @UniqueConstraint(name = "uq_media_version", columnNames = {"media_file_id", "version_number"})
})
public class MediaVersion {

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
     * 版本号
     */
    @Column(name = "version_number", nullable = false)
    private Integer versionNumber;

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
     * 变更描述
     */
    @Column(name = "change_description", columnDefinition = "TEXT")
    private String changeDescription;

    /**
     * 创建者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;
}
