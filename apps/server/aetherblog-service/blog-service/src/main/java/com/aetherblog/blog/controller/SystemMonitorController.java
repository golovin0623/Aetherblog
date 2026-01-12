package com.aetherblog.blog.controller;

import com.aetherblog.blog.service.SystemMonitorService;
import com.aetherblog.blog.service.SystemMonitorService.*;
import com.aetherblog.blog.service.MetricsHistoryService;
import com.aetherblog.blog.service.MetricsHistoryService.*;
import com.aetherblog.blog.service.ContainerMonitorService;
import com.aetherblog.blog.service.ContainerMonitorService.*;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 系统监控控制器
 * 
 * @description 提供 CPU/内存/磁盘/JVM 指标、存储明细、服务健康状态、历史趋势、告警
 * @ref §8.2 - Dashboard 系统监控
 */
@Tag(name = "系统监控", description = "系统运行状态监控接口")
@RestController
@RequestMapping("/v1/admin/system")
@RequiredArgsConstructor
public class SystemMonitorController {

    private final SystemMonitorService systemMonitorService;
    private final MetricsHistoryService metricsHistoryService;
    private final ContainerMonitorService containerMonitorService;

    // ========== 实时指标 ==========

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

    /**
     * 获取 Docker 容器资源使用情况
     */
    @Operation(summary = "获取容器资源监控")
    @GetMapping("/containers")
    public R<ContainerOverview> getContainerMetrics() {
        return R.ok(containerMonitorService.getContainerMetrics());
    }

    /**
     * 获取容器实时日志
     */
    @Operation(summary = "获取容器实时日志")
    @GetMapping("/containers/{id}/logs")
    public R<List<String>> getContainerLogs(@PathVariable String id) {
        return R.ok(containerMonitorService.getContainerLogs(id));
    }

    // ========== 历史数据 ==========

    /**
     * 获取历史趋势数据 (用于图表)
     * @param minutes 最近 N 分钟，默认 60
     * @param maxPoints 最大数据点数，默认 60
     */
    @Operation(summary = "获取历史趋势数据")
    @GetMapping("/history")
    public R<MetricHistory> getHistory(
            @RequestParam(defaultValue = "60") int minutes,
            @RequestParam(defaultValue = "60") int maxPoints) {
        return R.ok(metricsHistoryService.getHistory(minutes, maxPoints));
    }

    /**
     * 获取历史数据统计
     */
    @Operation(summary = "获取历史数据统计")
    @GetMapping("/history/stats")
    public R<Map<String, Object>> getHistoryStats() {
        return R.ok(metricsHistoryService.getHistoryStats());
    }

    /**
     * 清理历史数据
     */
    @Operation(summary = "清理历史数据")
    @DeleteMapping("/history")
    public R<Integer> cleanupHistory() {
        int cleaned = metricsHistoryService.cleanupHistory();
        return R.ok(cleaned);
    }

    // ========== 告警 ==========

    /**
     * 获取当前活跃告警
     */
    @Operation(summary = "获取活跃告警")
    @GetMapping("/alerts")
    public R<List<Alert>> getActiveAlerts() {
        return R.ok(metricsHistoryService.getActiveAlerts());
    }

    // ========== 配置 ==========

    /**
     * 获取监控配置
     */
    @Operation(summary = "获取监控配置")
    @GetMapping("/config")
    public R<MonitoringConfig> getConfig() {
        return R.ok(metricsHistoryService.getConfig());
    }
}

