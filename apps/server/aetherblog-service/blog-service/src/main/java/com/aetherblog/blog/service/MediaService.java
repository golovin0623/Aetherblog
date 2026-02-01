package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.common.core.domain.PageResult;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * 媒体文件服务接口
 * 
 * @ref §8.2-4 - 媒体管理模块
 */
public interface MediaService {

    /**
     * 上传文件
     * @param file 文件
     * @param uploaderId 上传者ID
     * @param folderId 文件夹ID (可选)
     */
    MediaFile upload(MultipartFile file, Long uploaderId, Long folderId);

    /**
     * 批量上传
     * @param files 文件列表
     * @param uploaderId 上传者ID
     * @param folderId 文件夹ID (可选)
     */
    List<MediaFile> uploadBatch(List<MultipartFile> files, Long uploaderId, Long folderId);

    /**
     * 获取文件详情
     */
    MediaFile getById(Long id);

    /**
     * 分页获取所有文件
     * @param fileTypeStr 文件类型
     * @param keyword 关键词
     * @param folderId 文件夹ID (可选，null表示所有文件)
     * @param pageNum 页码
     * @param pageSize 每页大小
     */
    PageResult<MediaFile> listPage(String fileTypeStr, String keyword, Long folderId, int pageNum, int pageSize);

    /**
     * 获取用户上传的文件
     */
    PageResult<MediaFile> listByUploader(Long uploaderId, int pageNum, int pageSize);

    /**
     * 删除文件
     */
    void delete(Long id);

    /**
     * 批量删除
     */
    void batchDelete(List<Long> ids);

    /**
     * 获取存储统计
     */
    Map<String, Object> getStorageStats();

    /**
     * 更新文件信息
     */
    MediaFile update(Long id, String altText, String originalName);

    /**
     * 移动文件到指定文件夹
     * @param id 文件ID
     * @param folderId 目标文件夹ID (null表示移动到根目录)
     * @return 更新后的文件信息
     */
    MediaFile moveToFolder(Long id, Long folderId);

    /**
     * 批量移动文件到指定文件夹
     * @param ids 文件ID列表
     * @param folderId 目标文件夹ID (null表示移动到根目录)
     */
    void batchMoveToFolder(List<Long> ids, Long folderId);

    /**
     * 软删除文件（移入回收站）
     * @param id 文件ID
     */
    void softDelete(Long id);

    /**
     * 批量软删除文件（移入回收站）
     * @param ids 文件ID列表
     */
    void batchSoftDelete(List<Long> ids);

    /**
     * 获取回收站文件列表
     * @param pageNum 页码
     * @param pageSize 每页大小
     */
    PageResult<MediaFile> listTrash(int pageNum, int pageSize);

    /**
     * 从回收站恢复文件
     * @param id 文件ID
     */
    MediaFile restore(Long id);

    /**
     * 批量从回收站恢复文件
     * @param ids 文件ID列表
     */
    void batchRestore(List<Long> ids);

    /**
     * 彻底删除文件（从回收站永久删除）
     * @param id 文件ID
     */
    void permanentDelete(Long id);

    /**
     * 批量彻底删除文件
     * @param ids 文件ID列表
     */
    void batchPermanentDelete(List<Long> ids);

    /**
     * 清空回收站
     */
    void emptyTrash();

    /**
     * 获取回收站文件数量
     */
    long getTrashCount();
}
