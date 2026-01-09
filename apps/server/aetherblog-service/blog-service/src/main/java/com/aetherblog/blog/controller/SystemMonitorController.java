package com.aetherblog.blog.controller;

import com.aetherblog.blog.service.SystemMonitorService;
import com.aetherblog.blog.service.SystemMonitorService.*;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 系统监控控制器
 * 
 * @description 提供 CPU/内存/磁盘/JVM 指标、存储明细、服务健康状态
 * @ref §8.2 - Dashboard 系统监控
 */
@Tag(name = "系统监控", description = "系统运行状态监控接口")
@RestController
@RequestMapping("/v1/admin/system")
@RequiredArgsConstructor
public class SystemMonitorController {

    private final SystemMonitorService systemMonitorService;

    /**
     * 获取系统指标 (CPU/内存/磁盘/JVM)
     */
    @Operation(summary = "获取系统指标")
    @GetMapping("/metrics")
    public R<SystemMetrics> getSystemMetrics() {
        return R.ok(systemMonitorService.getSystemMetrics());
    }

    /**
     * 获取存储明细 (上传文件/数据库/日志)
     */
    @Operation(summary = "获取存储明细")
    @GetMapping("/storage")
    public R<StorageDetails> getStorageDetails() {
        return R.ok(systemMonitorService.getStorageDetails());
    }

    /**
     * 获取服务健康状态 (PostgreSQL/Redis/ES)
     */
    @Operation(summary = "获取服务健康状态")
    @GetMapping("/health")
    public R<List<ServiceHealth>> getServicesHealth() {
        return R.ok(systemMonitorService.getServicesHealth());
    }

    /**
     * 获取完整监控数据 (一次性获取所有)
     */
    @Operation(summary = "获取完整监控数据")
    @GetMapping("/overview")
    public R<MonitorOverview> getMonitorOverview() {
        return R.ok(systemMonitorService.getMonitorOverview());
    }
}
