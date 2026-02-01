package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 媒体分享实体
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Data
@Entity
@Table(name = "media_shares", indexes = {
    @Index(name = "idx_media_shares_token", columnList = "share_token"),
    @Index(name = "idx_media_shares_file", columnList = "media_file_id"),
    @Index(name = "idx_media_shares_folder", columnList = "folder_id")
})
public class MediaShare {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 分享令牌 (UUID)
     */
    @Column(name = "share_token", nullable = false, unique = true, length = 64)
    private String shareToken;

    /**
     * 分享的媒体文件 (与folder_id二选一)
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "media_file_id")
    private MediaFile mediaFile;

    /**
     * 分享的文件夹 (与media_file_id二选一)
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "folder_id")
    private MediaFolder folder;

    /**
     * 分享类型
     */
    @Column(name = "share_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private ShareType shareType;

    /**
     * 访问类型
     */
    @Column(name = "access_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private AccessType accessType = AccessType.VIEW;

    /**
     * 创建者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    private User createdBy;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    /**
     * 过期时间
     */
    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    /**
     * 访问次数
     */
    @Column(name = "access_count", nullable = false)
    private Integer accessCount = 0;

    /**
     * 最大访问次数
     */
    @Column(name = "max_access_count")
    private Integer maxAccessCount;

    /**
     * 密码哈希
     */
    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    /**
     * 分享类型枚举
     */
    public enum ShareType {
        FILE,   // 文件分享
        FOLDER  // 文件夹分享
    }

    /**
     * 访问类型枚举
     */
    public enum AccessType {
        VIEW,     // 仅查看
        DOWNLOAD  // 允许下载
    }

    /**
     * 检查是否过期
     */
    public boolean isExpired() {
        if (expiresAt != null && LocalDateTime.now().isAfter(expiresAt)) {
            return true;
        }
        return maxAccessCount != null && accessCount >= maxAccessCount;
    }

    /**
     * 增加访问次数
     */
    public void incrementAccessCount() {
        this.accessCount++;
    }
}
