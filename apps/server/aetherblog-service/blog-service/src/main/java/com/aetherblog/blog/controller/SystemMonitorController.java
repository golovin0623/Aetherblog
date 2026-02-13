package com.aetherblog.blog.controller;

import com.aetherblog.blog.service.SystemMonitorService;
import com.aetherblog.blog.service.SystemMonitorService.*;
import com.aetherblog.blog.service.MetricsHistoryService;
import com.aetherblog.blog.service.MetricsHistoryService.*;
import com.aetherblog.blog.service.ContainerMonitorService;
import com.aetherblog.blog.service.ContainerMonitorService.*;
import com.aetherblog.blog.service.LogViewerService;
import com.aetherblog.blog.service.LogViewerService.*;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
    private final LogViewerService logViewerService;

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

    // ========== 日志管理 ==========

    /**
     * 按级别获取应用日志
     * @param level 日志级别 (ALL/INFO/WARN/ERROR/DEBUG)
     * @param lines 行数限制，默认 2000
     */
    @Operation(summary = "按级别获取应用日志")
    @GetMapping("/logs")
    public R<Object> getLogs(
            @RequestParam(defaultValue = "ALL") String level,
            @RequestParam(defaultValue = "2000") int lines,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String cursor) {
        LogViewerService.LogReadResult result = logViewerService.queryLogs(level, lines, limit, keyword, cursor);
        boolean enhancedQuery = (limit != null)
                || (keyword != null && !keyword.isBlank())
                || (cursor != null && !cursor.isBlank());

        if (result.isError()) {
            return R.fail(500, result.getMessage(), result.getErrorCategory());
        }

        if (!enhancedQuery) {
            if (result.isNoData()) {
                return R.ok(result.getLogs(), result.getMessage(), result.getErrorCategory());
            }
            return R.ok(result.getLogs());
        }

        Map<String, Object> payload = new java.util.HashMap<>();
        payload.put("lines", result.getLogs());
        payload.put("cursor", result.getCursor());
        payload.put("nextCursor", result.getNextCursor());

        if (result.isNoData()) {
            return R.ok(payload, result.getMessage(), result.getErrorCategory());
        }
        return R.ok(payload);
    }

    /**
     * 获取可用日志文件列表
     */
    @Operation(summary = "获取可用日志文件列表")
    @GetMapping("/logs/files")
    public R<List<LogFileInfo>> getLogFiles() {
        return R.ok(logViewerService.getAvailableLogFiles());
    }

    /**
     * 下载日志文件
     * @param level 日志级别 (ALL/INFO/WARN/ERROR/DEBUG)
     */
    @Operation(summary = "下载日志文件")
    @GetMapping("/logs/download")
    public ResponseEntity<Resource> downloadLog(@RequestParam(defaultValue = "ALL") String level) {
        Resource resource = logViewerService.getLogFileResource(level);
        if (resource == null || !resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        
        String filename = level.toLowerCase() + ".log";
        if ("ALL".equalsIgnoreCase(level)) {
            filename = "aetherblog.log";
        }
        
        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_PLAIN)
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
            .body(resource);
    }

    /**
     * 手动触发网络带宽测速
     */
    @Operation(summary = "手动触发网络带宽测速")
    @PostMapping("/network/test")
    public R<String> testNetworkBandwidth() {
        // 异步执行
        new Thread(systemMonitorService::autoDetectBandwidth).start();
        return R.ok("带宽测速任务已启动，请稍后刷新查看");
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
