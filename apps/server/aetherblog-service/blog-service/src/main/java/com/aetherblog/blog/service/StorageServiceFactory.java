package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;

/**
 * 存储服务工厂
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Component
@RequiredArgsConstructor
public class StorageServiceFactory {

    private final ApplicationContext applicationContext;

    /**
     * 根据存储提供商类型获取对应的存储服务实现
     *
     * @param provider 存储提供商
     * @return 存储服务实现
     */
    public StorageService getStorageService(StorageProvider provider) {
        if (provider == null) {
            throw new BusinessException(400, "存储提供商不能为空");
        }

        String beanName = switch (provider.getProviderType()) {
            case LOCAL -> "localStorageServiceImpl";
            case S3 -> "s3StorageService";
            case MINIO -> "minioStorageService";
            case OSS, COS -> throw new BusinessException(501, "暂不支持的存储类型: " + provider.getProviderType());
        };

        try {
            return applicationContext.getBean(beanName, StorageService.class);
        } catch (Exception e) {
            throw new BusinessException(500, "不支持的存储类型: " + provider.getProviderType());
        }
    }
}
