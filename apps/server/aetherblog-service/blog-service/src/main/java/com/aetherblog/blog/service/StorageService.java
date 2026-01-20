package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.StorageProvider;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;

/**
 * 存储服务接口 - 抽象层
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
public interface StorageService {

    /**
     * 上传文件
     *
     * @param file 文件
     * @param provider 存储提供商
     * @param path 存储路径
     * @return 上传结果
     */
    UploadResult upload(MultipartFile file, StorageProvider provider, String path);

    /**
     * 下载文件
     *
     * @param path 文件路径
     * @param provider 存储提供商
     * @return 文件输入流
     */
    InputStream download(String path, StorageProvider provider);

    /**
     * 删除文件
     *
     * @param path 文件路径
     * @param provider 存储提供商
     */
    void delete(String path, StorageProvider provider);

    /**
     * 获取文件访问URL
     *
     * @param path 文件路径
     * @param provider 存储提供商
     * @return 访问URL
     */
    String getUrl(String path, StorageProvider provider);

    /**
     * 获取CDN加速URL
     *
     * @param path 文件路径
     * @param provider 存储提供商
     * @return CDN URL
     */
    String getCdnUrl(String path, StorageProvider provider);

    /**
     * 测试连接
     *
     * @param provider 存储提供商
     * @return 是否连接成功
     */
    boolean testConnection(StorageProvider provider);

    /**
     * 上传结果
     */
    record UploadResult(
        String path,
        String url,
        String cdnUrl,
        Long size
    ) {}
}
