package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.blog.repository.StorageProviderRepository;
import com.aetherblog.blog.service.StorageProviderService;
import com.aetherblog.blog.service.StorageService;
import com.aetherblog.blog.service.StorageServiceFactory;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

/**
 * 存储提供商服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StorageProviderServiceImpl implements StorageProviderService {

    private final StorageProviderRepository storageProviderRepository;
    private final StorageServiceFactory storageServiceFactory;

    @Override
    @Transactional
    public StorageProvider create(CreateStorageProviderRequest request) {
        Objects.requireNonNull(request, "创建请求不能为空");
        Objects.requireNonNull(request.name(), "提供商名称不能为空");
        Objects.requireNonNull(request.providerType(), "提供商类型不能为空");
        Objects.requireNonNull(request.configJson(), "配置不能为空");

        // 检查名称是否已存在
        if (storageProviderRepository.existsByName(request.name())) {
            throw new BusinessException(400, "存储提供商名称已存在: " + request.name());
        }

        StorageProvider provider = new StorageProvider();
        provider.setName(request.name());
        provider.setProviderType(request.providerType());
        provider.setConfigJson(request.configJson());
        provider.setIsDefault(request.isDefault() != null ? request.isDefault() : false);
        provider.setIsEnabled(request.isEnabled() != null ? request.isEnabled() : true);
        provider.setPriority(request.priority() != null ? request.priority() : 0);

        // 如果设置为默认,清除其他默认标记
        if (Boolean.TRUE.equals(provider.getIsDefault())) {
            storageProviderRepository.clearAllDefaults();
        }

        StorageProvider saved = storageProviderRepository.save(provider);
        log.info("创建存储提供商: id={}, name={}, type={}", saved.getId(), saved.getName(), saved.getProviderType());
        return saved;
    }

    @Override
    @Transactional
    public StorageProvider update(Long id, UpdateStorageProviderRequest request) {
        Objects.requireNonNull(id, "提供商ID不能为空");
        Objects.requireNonNull(request, "更新请求不能为空");

        StorageProvider provider = getById(id);

        if (request.name() != null) {
            // 检查新名称是否与其他提供商冲突
            if (!provider.getName().equals(request.name()) &&
                storageProviderRepository.existsByName(request.name())) {
                throw new BusinessException(400, "存储提供商名称已存在: " + request.name());
            }
            provider.setName(request.name());
        }

        if (request.configJson() != null) {
            provider.setConfigJson(request.configJson());
        }

        if (request.isEnabled() != null) {
            provider.setIsEnabled(request.isEnabled());
        }

        if (request.priority() != null) {
            provider.setPriority(request.priority());
        }

        StorageProvider updated = storageProviderRepository.save(provider);
        log.info("更新存储提供商: id={}, name={}", updated.getId(), updated.getName());
        return updated;
    }

    @Override
    @Transactional
    public void delete(Long id) {
        Objects.requireNonNull(id, "提供商ID不能为空");
        StorageProvider provider = getById(id);

        // 不允许删除默认提供商
        if (Boolean.TRUE.equals(provider.getIsDefault())) {
            throw new BusinessException(400, "不能删除默认存储提供商");
        }

        storageProviderRepository.deleteById(id);
        log.info("删除存储提供商: id={}, name={}", id, provider.getName());
    }

    @Override
    public StorageProvider getById(Long id) {
        Objects.requireNonNull(id, "提供商ID不能为空");
        return storageProviderRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "存储提供商不存在: " + id));
    }

    @Override
    public List<StorageProvider> getAll() {
        return storageProviderRepository.findAll();
    }

    @Override
    public StorageProvider getDefault() {
        return storageProviderRepository.findByIsDefaultTrue()
                .orElseThrow(() -> new BusinessException(500, "未配置默认存储提供商"));
    }

    @Override
    @Transactional
    public void setAsDefault(Long id) {
        Objects.requireNonNull(id, "提供商ID不能为空");
        StorageProvider provider = getById(id);

        // 清除所有默认标记
        storageProviderRepository.clearAllDefaults();

        // 设置新的默认
        storageProviderRepository.setAsDefault(id);

        log.info("设置默认存储提供商: id={}, name={}", id, provider.getName());
    }

    @Override
    public boolean testConnection(Long id) {
        Objects.requireNonNull(id, "提供商ID不能为空");
        StorageProvider provider = getById(id);

        try {
            StorageService storageService = storageServiceFactory.getStorageService(provider);
            boolean result = storageService.testConnection(provider);
            log.info("存储提供商连接测试: id={}, name={}, result={}", id, provider.getName(), result);
            return result;
        } catch (Exception e) {
            log.error("存储提供商连接测试失败: id={}, name={}", id, provider.getName(), e);
            return false;
        }
    }
}
