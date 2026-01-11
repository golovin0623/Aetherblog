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
     */
    MediaFile upload(MultipartFile file, Long uploaderId);

    /**
     * 批量上传
     */
    List<MediaFile> uploadBatch(List<MultipartFile> files, Long uploaderId);

    /**
     * 获取文件详情
     */
    MediaFile getById(Long id);

    /**
     * 分页获取所有文件
     */
    PageResult<MediaFile> listPage(String fileTypeStr, String keyword, int pageNum, int pageSize);

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
}
