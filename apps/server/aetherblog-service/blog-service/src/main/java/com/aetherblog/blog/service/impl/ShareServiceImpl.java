package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaFolder;
import com.aetherblog.blog.entity.MediaShare;
import com.aetherblog.blog.entity.MediaShare.ShareType;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.MediaFileRepository;
import com.aetherblog.blog.repository.MediaFolderRepository;
import com.aetherblog.blog.repository.MediaShareRepository;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.blog.service.ShareService;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * 分享服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ShareServiceImpl implements ShareService {

    private final MediaShareRepository shareRepository;
    private final MediaFileRepository fileRepository;
    private final MediaFolderRepository folderRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Override
    @Transactional
    public MediaShare createFileShare(Long fileId, ShareConfig config) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        Objects.requireNonNull(config, "分享配置不能为空");

        MediaFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new BusinessException(404, "文件不存在"));

        MediaShare share = new MediaShare();
        share.setShareToken(generateUniqueToken());
        share.setMediaFile(file);
        share.setShareType(ShareType.FILE);
        share.setAccessType(config.accessType());
        share.setExpiresAt(config.expiresAt());
        share.setMaxAccessCount(config.maxAccessCount());

        if (config.password() != null) {
            share.setPasswordHash(passwordEncoder.encode(config.password()));
        }

        if (config.createdBy() != null) {
            User creator = userRepository.findById(config.createdBy()).orElse(null);
            share.setCreatedBy(creator);
        }

        MediaShare saved = shareRepository.save(share);
        log.info("创建文件分享: fileId={}, token={}", fileId, saved.getShareToken());
        return saved;
    }

    @Override
    @Transactional
    public MediaShare createFolderShare(Long folderId, ShareConfig config) {
        Objects.requireNonNull(folderId, "文件夹ID不能为空");
        Objects.requireNonNull(config, "分享配置不能为空");

        MediaFolder folder = folderRepository.findById(folderId)
                .orElseThrow(() -> new BusinessException(404, "文件夹不存在"));

        MediaShare share = new MediaShare();
        share.setShareToken(generateUniqueToken());
        share.setFolder(folder);
        share.setShareType(ShareType.FOLDER);
        share.setAccessType(config.accessType());
        share.setExpiresAt(config.expiresAt());
        share.setMaxAccessCount(config.maxAccessCount());

        if (config.password() != null) {
            share.setPasswordHash(passwordEncoder.encode(config.password()));
        }

        if (config.createdBy() != null) {
            User creator = userRepository.findById(config.createdBy()).orElse(null);
            share.setCreatedBy(creator);
        }

        MediaShare saved = shareRepository.save(share);
        log.info("创建文件夹分享: folderId={}, token={}", folderId, saved.getShareToken());
        return saved;
    }

    @Override
    public MediaShare getByToken(String token) {
        Objects.requireNonNull(token, "分享令牌不能为空");
        return shareRepository.findByShareToken(token)
                .orElseThrow(() -> new BusinessException(404, "分享不存在或已过期"));
    }

    @Override
    public boolean validateAccess(String token, String password) {
        Objects.requireNonNull(token, "分享令牌不能为空");

        MediaShare share = shareRepository.findByShareToken(token)
                .orElse(null);

        if (share == null) {
            return false;
        }

        // 检查是否过期
        if (share.isExpired()) {
            return false;
        }

        // 检查密码
        if (share.getPasswordHash() != null) {
            if (password == null) {
                return false;
            }
            return passwordEncoder.matches(password, share.getPasswordHash());
        }

        return true;
    }

    @Override
    @Transactional
    public void incrementAccessCount(String token) {
        Objects.requireNonNull(token, "分享令牌不能为空");
        shareRepository.incrementAccessCount(token);
        log.debug("增加访问次数: token={}", token);
    }

    @Override
    @Transactional
    public void revokeShare(String token) {
        Objects.requireNonNull(token, "分享令牌不能为空");
        MediaShare share = getByToken(token);
        shareRepository.delete(share);
        log.info("撤销分享: token={}", token);
    }

    @Override
    public List<MediaShare> getUserShares(Long userId) {
        Objects.requireNonNull(userId, "用户ID不能为空");
        return shareRepository.findByCreatedById(userId);
    }

    @Override
    @Transactional
    public void cleanupExpiredShares() {
        shareRepository.deleteExpiredShares();
        log.info("清理过期分享完成");
    }

    // ========== 辅助方法 ==========

    /**
     * 生成唯一令牌
     */
    private String generateUniqueToken() {
        String token;
        do {
            token = UUID.randomUUID().toString().replace("-", "");
        } while (shareRepository.existsByShareToken(token));
        return token;
    }
}
