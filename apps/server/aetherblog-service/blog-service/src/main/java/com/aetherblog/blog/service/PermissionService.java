package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.FolderPermission;
import com.aetherblog.blog.entity.FolderPermission.PermissionLevel;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 权限服务接口
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
public interface PermissionService {

    /**
     * 检查用户是否有权限
     *
     * @param folderId 文件夹ID
     * @param userId 用户ID
     * @param level 权限级别
     * @return 是否有权限
     */
    boolean hasPermission(Long folderId, Long userId, PermissionLevel level);

    /**
     * 获取用户的有效权限级别
     *
     * @param folderId 文件夹ID
     * @param userId 用户ID
     * @return 权限级别
     */
    PermissionLevel getEffectivePermission(Long folderId, Long userId);

    /**
     * 授予权限
     *
     * @param folderId 文件夹ID
     * @param userId 用户ID
     * @param level 权限级别
     * @param grantedBy 授权者ID
     * @param expiresAt 过期时间
     * @return 权限实体
     */
    FolderPermission grantPermission(Long folderId, Long userId, PermissionLevel level,
                                    Long grantedBy, LocalDateTime expiresAt);

    /**
     * 撤销权限
     *
     * @param folderId 文件夹ID
     * @param userId 用户ID
     */
    void revokePermission(Long folderId, Long userId);

    /**
     * 获取文件夹的所有权限
     *
     * @param folderId 文件夹ID
     * @return 权限列表
     */
    List<FolderPermission> getFolderPermissions(Long folderId);

    /**
     * 获取用户的所有权限
     *
     * @param userId 用户ID
     * @return 权限列表
     */
    List<FolderPermission> getUserPermissions(Long userId);

    /**
     * 清理过期权限
     */
    void cleanupExpiredPermissions();
}
