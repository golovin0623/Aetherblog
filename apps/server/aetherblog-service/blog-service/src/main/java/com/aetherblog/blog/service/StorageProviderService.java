package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.StorageProvider;

import java.util.List;

/**
 * 存储提供商服务接口
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
public interface StorageProviderService {

    /**
     * 创建存储提供商
     */
    StorageProvider create(CreateStorageProviderRequest request);

    /**
     * 更新存储提供商
     */
    StorageProvider update(Long id, UpdateStorageProviderRequest request);

    /**
     * 删除存储提供商
     */
    void delete(Long id);

    /**
     * 根据ID获取
     */
    StorageProvider getById(Long id);

    /**
     * 获取所有提供商
     */
    List<StorageProvider> getAll();

    /**
     * 获取默认提供商
     */
    StorageProvider getDefault();

    /**
     * 设置为默认
     */
    void setAsDefault(Long id);

    /**
     * 测试连接
     */
    boolean testConnection(Long id);

    /**
     * 创建请求
     */
    record CreateStorageProviderRequest(
        String name,
        StorageProvider.ProviderType providerType,
        String configJson,
        Boolean isDefault,
        Boolean isEnabled,
        Integer priority
    ) {}

    /**
     * 更新请求
     */
    record UpdateStorageProviderRequest(
        String name,
        String configJson,
        Boolean isEnabled,
        Integer priority
    ) {}
}
