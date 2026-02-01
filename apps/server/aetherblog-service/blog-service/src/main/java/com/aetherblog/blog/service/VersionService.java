package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaVersion;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * 版本控制服务接口
 *
 * @ref 媒体库深度优化方案 - Phase 5: 协作与权限
 * @author AI Assistant
 * @since 2.5.0
 */
public interface VersionService {

    /**
     * 创建新版本
     *
     * @param fileId 文件ID
     * @param newFile 新文件
     * @param description 变更描述
     * @param userId 用户ID
     * @return 版本实体
     */
    MediaVersion createVersion(Long fileId, MultipartFile newFile, String description, Long userId);

    /**
     * 获取版本历史
     *
     * @param fileId 文件ID
     * @return 版本列表
     */
    List<MediaVersion> getVersionHistory(Long fileId);

    /**
     * 获取指定版本
     *
     * @param fileId 文件ID
     * @param versionNumber 版本号
     * @return 版本实体
     */
    MediaVersion getVersion(Long fileId, Integer versionNumber);

    /**
     * 恢复到指定版本
     *
     * @param fileId 文件ID
     * @param versionNumber 版本号
     * @param userId 用户ID
     * @return 更新后的文件
     */
    MediaFile restoreVersion(Long fileId, Integer versionNumber, Long userId);

    /**
     * 删除版本
     *
     * @param versionId 版本ID
     */
    void deleteVersion(Long versionId);

    /**
     * 删除文件的所有版本
     *
     * @param fileId 文件ID
     */
    void deleteAllVersions(Long fileId);

    /**
     * 获取最新版本号
     *
     * @param fileId 文件ID
     * @return 版本号
     */
    Integer getLatestVersionNumber(Long fileId);
}
