package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.MediaShare;
import com.aetherblog.blog.entity.MediaShare.AccessType;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 分享服务接口
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
public interface ShareService {

    /**
     * 创建文件分享
     *
     * @param fileId 文件ID
     * @param config 分享配置
     * @return 分享实体
     */
    MediaShare createFileShare(Long fileId, ShareConfig config);

    /**
     * 创建文件夹分享
     *
     * @param folderId 文件夹ID
     * @param config 分享配置
     * @return 分享实体
     */
    MediaShare createFolderShare(Long folderId, ShareConfig config);

    /**
     * 根据令牌获取分享
     *
     * @param token 分享令牌
     * @return 分享实体
     */
    MediaShare getByToken(String token);

    /**
     * 验证访问权限
     *
     * @param token 分享令牌
     * @param password 密码 (可选)
     * @return 是否有权限
     */
    boolean validateAccess(String token, String password);

    /**
     * 增加访问次数
     *
     * @param token 分享令牌
     */
    void incrementAccessCount(String token);

    /**
     * 撤销分享
     *
     * @param token 分享令牌
     */
    void revokeShare(String token);

    /**
     * 获取用户的所有分享
     *
     * @param userId 用户ID
     * @return 分享列表
     */
    List<MediaShare> getUserShares(Long userId);

    /**
     * 清理过期分享
     */
    void cleanupExpiredShares();

    /**
     * 分享配置
     */
    record ShareConfig(
        AccessType accessType,
        LocalDateTime expiresAt,
        Integer maxAccessCount,
        String password,
        Long createdBy
    ) {}
}
