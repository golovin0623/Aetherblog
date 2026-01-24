package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.FolderPermission;
import com.aetherblog.blog.entity.FolderPermission.PermissionLevel;
import com.aetherblog.blog.entity.MediaFolder;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.FolderPermissionRepository;
import com.aetherblog.blog.repository.MediaFolderRepository;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.blog.service.PermissionService;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * 权限服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PermissionServiceImpl implements PermissionService {

    private final FolderPermissionRepository permissionRepository;
    private final MediaFolderRepository folderRepository;
    private final UserRepository userRepository;

    // 权限级别顺序: VIEW < UPLOAD < EDIT < DELETE < ADMIN
    private static final List<PermissionLevel> PERMISSION_HIERARCHY = List.of(
            PermissionLevel.VIEW,
            PermissionLevel.UPLOAD,
            PermissionLevel.EDIT,
            PermissionLevel.DELETE,
            PermissionLevel.ADMIN
    );

    @Override
    public boolean hasPermission(Long folderId, Long userId, PermissionLevel level) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");
        Objects.requireNonNull(userId, "用户ID不能为空");
        Objects.requireNonNull(level, "权限级别不能为空");

        // 检查文件夹所有者
        MediaFolder folder = folderRepository.findById(folderId)
                .orElseThrow(() -> new BusinessException(404, "文件夹不存在"));

        if (folder.getOwner() != null && folder.getOwner().getId().equals(userId)) {
            return true; // 所有者拥有所有权限
        }

        // 检查显式权限
        PermissionLevel effectiveLevel = getEffectivePermission(folderId, userId);
        return effectiveLevel != null && hasPermissionLevel(effectiveLevel, level);
    }

    @Override
    public PermissionLevel getEffectivePermission(Long folderId, Long userId) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");
        Objects.requireNonNull(userId, "用户ID不能为空");

        Optional<FolderPermission> permission = permissionRepository.findByFolderIdAndUserId(folderId, userId);

        if (permission.isPresent() && !permission.get().isExpired()) {
            return permission.get().getPermissionLevel();
        }

        return null;
    }

    @Override
    @Transactional
    public FolderPermission grantPermission(Long folderId, Long userId, PermissionLevel level,
                                           Long grantedBy, LocalDateTime expiresAt) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");
        Objects.requireNonNull(userId, "用户ID不能为空");
        Objects.requireNonNull(level, "权限级别不能为空");

        MediaFolder folder = folderRepository.findById(folderId)
                .orElseThrow(() -> new BusinessException(404, "文件夹不存在"));

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));

        User grantor = null;
        if (grantedBy != null) {
            grantor = userRepository.findById(grantedBy).orElse(null);
        }

        // 检查是否已存在权限
        Optional<FolderPermission> existing = permissionRepository.findByFolderIdAndUserId(folderId, userId);

        FolderPermission permission;
        if (existing.isPresent()) {
            // 更新现有权限
            permission = existing.get();
            permission.setPermissionLevel(level);
            permission.setExpiresAt(expiresAt);
            permission.setGrantedBy(grantor);
        } else {
            // 创建新权限
            permission = new FolderPermission();
            permission.setFolder(folder);
            permission.setUser(user);
            permission.setPermissionLevel(level);
            permission.setGrantedBy(grantor);
            permission.setExpiresAt(expiresAt);
        }

        FolderPermission saved = permissionRepository.save(permission);
        log.info("授予权限: folderId={}, userId={}, level={}", folderId, userId, level);
        return saved;
    }

    @Override
    @Transactional
    public void revokePermission(Long folderId, Long userId) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");
        Objects.requireNonNull(userId, "用户ID不能为空");

        Optional<FolderPermission> permission = permissionRepository.findByFolderIdAndUserId(folderId, userId);

        if (permission.isPresent()) {
            permissionRepository.delete(permission.get());
            log.info("撤销权限: folderId={}, userId={}", folderId, userId);
        }
    }

    @Override
    public List<FolderPermission> getFolderPermissions(Long folderId) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");
        return permissionRepository.findByFolderId(folderId);
    }

    @Override
    public List<FolderPermission> getUserPermissions(Long userId) {
        Objects.requireNonNull(userId, "用户ID不能为空");
        return permissionRepository.findByUserId(userId);
    }

    @Override
    @Transactional
    public void cleanupExpiredPermissions() {
        List<FolderPermission> allPermissions = permissionRepository.findAll();
        int count = 0;

        for (FolderPermission permission : allPermissions) {
            if (permission.isExpired()) {
                permissionRepository.delete(permission);
                count++;
            }
        }

        log.info("清理过期权限: count={}", count);
    }

    // ========== 辅助方法 ==========

    /**
     * 检查权限级别是否满足要求
     */
    private boolean hasPermissionLevel(PermissionLevel current, PermissionLevel required) {
        int currentIndex = PERMISSION_HIERARCHY.indexOf(current);
        int requiredIndex = PERMISSION_HIERARCHY.indexOf(required);
        return currentIndex >= requiredIndex;
    }
}
