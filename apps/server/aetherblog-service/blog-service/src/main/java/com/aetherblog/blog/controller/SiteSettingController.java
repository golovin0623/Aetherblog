package com.aetherblog.blog.controller;

import com.aetherblog.blog.service.SiteSettingService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 站点设置管理控制器 (Admin)
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §3.2.8 - 系统设置模块
 */
@Tag(name = "站点设置管理", description = "系统参数配置接口")
@RestController
@RequestMapping("/v1/admin/settings")
@RequiredArgsConstructor
public class SiteSettingController {

    private final SiteSettingService siteSettingService;

    @Operation(summary = "获取所有设置")
    @GetMapping
    public R<Map<String, Object>> list() {
        return R.ok(siteSettingService.getAllSettings());
    }

    @Operation(summary = "获取指定分租设置")
    @GetMapping("/group/{group}")
    public R<Map<String, Object>> listByGroup(@PathVariable String group) {
        return R.ok(siteSettingService.getSettingsByGroup(group));
    }

    @Operation(summary = "批量更新设置")
    @PatchMapping("/batch")
    public R<Void> batchUpdate(@RequestBody Map<String, String> settings) {
        siteSettingService.batchUpdate(settings);
        return R.ok();
    }

    @Operation(summary = "获取单个设置")
    @GetMapping("/{key}")
    public R<String> getByKey(@PathVariable String key) {
        return R.ok(siteSettingService.getString(key));
    }

    @Operation(summary = "更新单个设置")
    @PutMapping("/{key}")
    public R<Void> updateByKey(@PathVariable String key, @RequestBody String value) {
        siteSettingService.updateSetting(key, value);
        return R.ok();
    }
}
