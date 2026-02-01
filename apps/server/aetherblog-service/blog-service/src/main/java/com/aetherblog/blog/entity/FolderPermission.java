package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 文件夹权限实体
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Data
@Entity
@Table(name = "folder_permissions", indexes = {
    @Index(name = "idx_folder_permissions_folder", columnList = "folder_id"),
    @Index(name = "idx_folder_permissions_user", columnList = "user_id")
}, uniqueConstraints = {
    @UniqueConstraint(name = "uq_folder_user_permission", columnNames = {"folder_id", "user_id"})
})
public class FolderPermission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 文件夹
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "folder_id", nullable = false)
    private MediaFolder folder;

    /**
     * 用户
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /**
     * 权限级别
     */
    @Column(name = "permission_level", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private PermissionLevel permissionLevel;

    /**
     * 授权者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "granted_by")
    private User grantedBy;

    @CreationTimestamp
    @Column(name = "granted_at")
    private LocalDateTime grantedAt;

    /**
     * 过期时间
     */
    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    /**
     * 权限级别枚举
     */
    public enum PermissionLevel {
        VIEW,    // 查看
        UPLOAD,  // 上传
        EDIT,    // 编辑
        DELETE,  // 删除
        ADMIN    // 管理员
    }

    /**
     * 检查权限是否过期
     */
    public boolean isExpired() {
        return expiresAt != null && LocalDateTime.now().isAfter(expiresAt);
    }
}
