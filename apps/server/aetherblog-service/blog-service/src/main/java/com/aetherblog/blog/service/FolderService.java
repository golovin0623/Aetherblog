package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.MediaFolder;

import java.util.List;

/**
 * 文件夹服务接口
 *
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 * @author AI Assistant
 * @since 2.1.0
 */
public interface FolderService {

    /**
     * 创建文件夹
     *
     * @param name 文件夹名称
     * @param description 描述
     * @param parentId 父文件夹ID (null表示根目录)
     * @param userId 创建者ID
     * @return 创建的文件夹
     */
    MediaFolder create(String name, String description, Long parentId, Long userId);

    /**
     * 更新文件夹
     *
     * @param id 文件夹ID
     * @param name 新名称
     * @param description 新描述
     * @param color 颜色
     * @param icon 图标
     * @param userId 更新者ID
     * @return 更新后的文件夹
     */
    MediaFolder update(Long id, String name, String description, String color, String icon, Long userId);

    /**
     * 删除文件夹 (级联删除子文件夹和文件)
     *
     * @param id 文件夹ID
     */
    void delete(Long id);

    /**
     * 根据ID获取文件夹
     *
     * @param id 文件夹ID
     * @return 文件夹实体
     */
    MediaFolder getById(Long id);

    /**
     * 根据路径获取文件夹
     *
     * @param path 文件夹路径
     * @return 文件夹实体
     */
    MediaFolder getByPath(String path);

    /**
     * 获取完整文件夹树
     *
     * @return 文件夹树列表
     */
    List<MediaFolder> getTree();

    /**
     * 获取指定用户可见的文件夹树
     *
     * @param userId 用户ID
     * @return 文件夹树列表
     */
    List<MediaFolder> getTreeByUserId(Long userId);

    /**
     * 获取父文件夹的直接子文件夹
     *
     * @param parentId 父文件夹ID (null表示根目录)
     * @return 子文件夹列表
     */
    List<MediaFolder> getChildren(Long parentId);

    /**
     * 移动文件夹到新的父文件夹
     *
     * @param folderId 要移动的文件夹ID
     * @param newParentId 新父文件夹ID (null表示移动到根目录)
     * @param userId 操作者ID
     * @return 移动后的文件夹
     */
    MediaFolder move(Long folderId, Long newParentId, Long userId);

    /**
     * 更新文件夹统计信息 (文件数量和总大小)
     *
     * @param folderId 文件夹ID
     */
    void updateStatistics(Long folderId);

    /**
     * 递归更新文件夹及其所有父文件夹的统计信息
     *
     * @param folderId 文件夹ID
     */
    void updateStatisticsRecursive(Long folderId);

    /**
     * 检查用户是否有权限访问文件夹
     *
     * @param folderId 文件夹ID
     * @param userId 用户ID
     * @return 如果用户拥有访问权限则返回 true
     */
    boolean hasAccess(Long folderId, Long userId);

    /**
     * 生成唯一的slug
     *
     * @param name 文件夹名称
     * @param parentId 父文件夹ID
     * @return 唯一的slug
     */
    String generateUniqueSlug(String name, Long parentId);
}
