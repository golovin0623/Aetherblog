package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 媒体文件实体
 * 
 * @ref §8.2-4 - 媒体管理模块
 */
@Data
@Entity
@Table(name = "media_files", indexes = {
    @Index(name = "idx_media_files_type", columnList = "file_type"),
    @Index(name = "idx_media_files_uploader", columnList = "uploader_id"),
    @Index(name = "idx_media_files_created", columnList = "createdAt")
})
public class MediaFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 存储文件名
     */
    @Column(nullable = false, length = 200)
    private String filename;

    /**
     * 原始文件名
     */
    @Column(name = "original_name", length = 200)
    private String originalName;

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
    private Long fileSize = 0L;

    /**
     * MIME 类型
     */
    @Column(name = "mime_type", length = 100)
    private String mimeType;

    /**
     * 文件类型
     */
    @Column(name = "file_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private FileType fileType = FileType.IMAGE;

    /**
     * 存储类型
     */
    @Column(name = "storage_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private StorageType storageType = StorageType.LOCAL;

    /**
     * 图片宽度
     */
    private Integer width;

    /**
     * 图片高度
     */
    private Integer height;

    /**
     * Alt 文本
     */
    @Column(name = "alt_text", length = 200)
    private String altText;

    /**
     * 上传者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "uploader_id")
    private User uploader;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public enum FileType {
        IMAGE, VIDEO, AUDIO, DOCUMENT, OTHER
    }

    public enum StorageType {
        LOCAL, MINIO, COS, OSS, S3
    }
}
