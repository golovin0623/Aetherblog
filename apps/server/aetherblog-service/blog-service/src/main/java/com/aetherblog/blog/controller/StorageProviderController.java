package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.blog.service.StorageProviderService;
import com.aetherblog.blog.service.StorageProviderService.CreateStorageProviderRequest;
import com.aetherblog.blog.service.StorageProviderService.UpdateStorageProviderRequest;
import com.aetherblog.common.core.domain.R;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 存储提供商控制器
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Slf4j
@RestController
@RequestMapping("/v1/admin/storage/providers")
@RequiredArgsConstructor
public class StorageProviderController {

    private final StorageProviderService storageProviderService;

    /**
     * 获取所有存储提供商
     */
    @GetMapping
    public R<List<StorageProvider>> getAll() {
        List<StorageProvider> providers = storageProviderService.getAll();
        return R.ok(providers);
    }

    /**
     * 根据ID获取存储提供商
     */
    @GetMapping("/{id}")
    public R<StorageProvider> getById(@PathVariable Long id) {
        StorageProvider provider = storageProviderService.getById(id);
        return R.ok(provider);
    }

    /**
     * 获取默认存储提供商
     */
    @GetMapping("/default")
    public R<StorageProvider> getDefault() {
        StorageProvider provider = storageProviderService.getDefault();
        return R.ok(provider);
    }

    /**
     * 创建存储提供商
     */
    @PostMapping
    public R<StorageProvider> create(@RequestBody CreateStorageProviderRequest request) {
        StorageProvider provider = storageProviderService.create(request);
        return R.ok(provider);
    }

    /**
     * 更新存储提供商
     */
    @PutMapping("/{id}")
    public R<StorageProvider> update(
            @PathVariable Long id,
            @RequestBody UpdateStorageProviderRequest request) {
        StorageProvider provider = storageProviderService.update(id, request);
        return R.ok(provider);
    }

    /**
     * 删除存储提供商
     */
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        storageProviderService.delete(id);
        return R.ok();
    }

    /**
     * 设置为默认存储提供商
     */
    @PostMapping("/{id}/set-default")
    public R<Void> setAsDefault(@PathVariable Long id) {
        storageProviderService.setAsDefault(id);
        return R.ok();
    }

    /**
     * 测试连接
     */
    @PostMapping("/{id}/test")
    public R<Map<String, Object>> testConnection(@PathVariable Long id) {
        boolean success = storageProviderService.testConnection(id);
        return R.ok(Map.of(
                "success", success,
                "message", success ? "连接成功" : "连接失败"
        ));
    }
}
