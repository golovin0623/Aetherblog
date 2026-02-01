package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.FolderPermission;
import com.aetherblog.blog.entity.FolderPermission.PermissionLevel;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 文件夹权限仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Repository
public interface FolderPermissionRepository extends JpaRepository<FolderPermission, Long> {

    /**
     * 查找文件夹的所有权限
     */
    List<FolderPermission> findByFolderId(Long folderId);

    /**
     * 查找用户的所有权限
     */
    List<FolderPermission> findByUserId(Long userId);

    /**
     * 查找用户对文件夹的权限
     */
    Optional<FolderPermission> findByFolderIdAndUserId(Long folderId, Long userId);

    /**
     * 检查用户是否有权限
     */
    @Query("SELECT CASE WHEN COUNT(p) > 0 THEN true ELSE false END " +
           "FROM FolderPermission p " +
           "WHERE p.folder.id = :folderId AND p.user.id = :userId " +
           "AND p.permissionLevel = :level " +
           "AND (p.expiresAt IS NULL OR p.expiresAt > CURRENT_TIMESTAMP)")
    boolean hasPermission(@Param("folderId") Long folderId,
                         @Param("userId") Long userId,
                         @Param("level") PermissionLevel level);

    /**
     * 删除文件夹的所有权限
     */
    void deleteByFolderId(Long folderId);

    /**
     * 删除用户的所有权限
     */
    void deleteByUserId(Long userId);
}
