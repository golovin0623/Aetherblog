package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 附件实体
 * 
 * @ref §6.1 - 附件表 (V2 新增)
 */
@Data
@Entity
@Table(name = "attachments", indexes = {
    @Index(name = "idx_attachments_post", columnList = "post_id"),
    @Index(name = "idx_attachments_uploader", columnList = "uploader_id"),
    @Index(name = "idx_attachments_storage", columnList = "storage_type")
})
public class Attachment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 关联文章 (可选)
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id")
    private Post post;

    /**
     * 存储文件名 (UUID生成)
     */
    @Column(nullable = false, length = 255)
    private String filename;

    /**
     * 原始文件名
     */
    @Column(name = "original_name", nullable = false, length = 255)
    private String originalName;

    /**
     * 存储类型
     */
    @Column(name = "storage_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private StorageType storageType = StorageType.LOCAL;

    /**
     * 存储路径
     */
    @Column(name = "storage_path", nullable = false, length = 500)
    private String storagePath;

    /**
     * 文件大小 (字节)
     */
    @Column(name = "file_size", nullable = false)
    private Long fileSize;

    /**
     * MIME 类型
     */
    @Column(name = "mime_type", nullable = false, length = 100)
    private String mimeType;

    /**
     * 下载次数
     */
    @Column(name = "download_count", nullable = false)
    private Integer downloadCount = 0;

    /**
     * 下载链接加密密钥 (可选)
     */
    @Column(name = "encryption_key", length = 100)
    private String encryptionKey;

    /**
     * 上传者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "uploader_id")
    private User uploader;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public enum StorageType {
        LOCAL, TENCENT_COS, ALIYUN_OSS, MINIO, AWS_S3
    }
}
