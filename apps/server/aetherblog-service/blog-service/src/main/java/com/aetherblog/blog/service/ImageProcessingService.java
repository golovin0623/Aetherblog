package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaVariant;
import com.aetherblog.blog.entity.MediaVariant.VariantType;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * 图像处理服务接口
 *
 * @ref 媒体库深度优化方案 - Phase 4: 图像处理
 * @author AI Assistant
 * @since 2.4.0
 */
public interface ImageProcessingService {

    /**
     * 生成缩略图
     *
     * @param file 媒体文件
     * @param width 宽度
     * @param height 高度
     * @return 变体实体
     */
    MediaVariant generateThumbnail(MediaFile file, int width, int height);

    /**
     * 生成所有预设变体 (异步)
     *
     * @param file 媒体文件
     * @return 变体列表
     */
    CompletableFuture<List<MediaVariant>> generateAllVariantsAsync(MediaFile file);

    /**
     * 格式转换
     *
     * @param file 媒体文件
     * @param format 目标格式 (webp, avif, jpg, png)
     * @param quality 质量 (0-100)
     * @return 变体实体
     */
    MediaVariant convertFormat(MediaFile file, String format, int quality);

    /**
     * 优化图片 (智能压缩)
     *
     * @param file 媒体文件
     * @param targetSizeKB 目标大小 (KB)
     * @return 优化后的变体
     */
    MediaVariant optimize(MediaFile file, int targetSizeKB);

    /**
     * 提取EXIF数据
     *
     * @param file 媒体文件
     * @return EXIF数据Map
     */
    Map<String, Object> extractExif(MediaFile file);

    /**
     * 生成Blurhash占位符
     *
     * @param file 媒体文件
     * @return Blurhash字符串
     */
    String generateBlurhash(MediaFile file);

    /**
     * 获取文件的所有变体
     *
     * @param fileId 文件ID
     * @return 变体列表
     */
    List<MediaVariant> getVariants(Long fileId);

    /**
     * 获取指定类型的变体
     *
     * @param fileId 文件ID
     * @param variantType 变体类型
     * @return 变体实体
     */
    MediaVariant getVariant(Long fileId, VariantType variantType);

    /**
     * 删除文件的所有变体
     *
     * @param fileId 文件ID
     */
    void deleteVariants(Long fileId);
}
