package com.aetherblog.blog.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.stream.Collectors;

/**
 * 系统指标历史记录服务
 * 
 * @description 存储 CPU/内存/磁盘历史数据，支持趋势图和告警检测
 * @ref §8.2 - Dashboard 系统监控增强
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MetricsHistoryService {

    private final SystemMonitorService systemMonitorService;

    // 历史数据存储 (内存中，可扩展到 Redis/数据库)
    private final Deque<MetricSnapshot> historyQueue = new ConcurrentLinkedDeque<>();
    
    // 告警状态追踪 (key: 指标名, value: 连续高位次数)
    private final Map<String, Integer> alertCounters = new HashMap<>();
    
    // 当前活跃告警
    private final List<Alert> activeAlerts = new ArrayList<>();

    // ========== 配置项 ==========
    
    @Value("${monitoring.history.retention-minutes:1440}")  // 默认保留 24 小时
    private int retentionMinutes;
    
    @Value("${monitoring.history.sample-interval-seconds:30}")  // 默认 30 秒采样
    private int sampleIntervalSeconds;
    
    @Value("${monitoring.alert.cpu-threshold:80}")
    private double cpuThreshold;
    
    @Value("${monitoring.alert.memory-threshold:85}")
    private double memoryThreshold;
    
    @Value("${monitoring.alert.disk-threshold:90}")
    private double diskThreshold;
    
    @Value("${monitoring.alert.sustained-count:5}")  // 连续 5 次才告警
    private int sustainedCount;

    // ========== 数据模型 ==========

    @Data
    public static class MetricSnapshot {
        private LocalDateTime timestamp;
        private double cpu;
        private double memory;
        private double disk;
        private long networkIn;  // 网络接收 bytes
        private long networkOut; // 网络发送 bytes
        
        public MetricSnapshot(double cpu, double memory, double disk, long networkIn, long networkOut) {
            this.timestamp = LocalDateTime.now();
            this.cpu = cpu;
            this.memory = memory;
            this.disk = disk;
            this.networkIn = networkIn;
            this.networkOut = networkOut;
        }
    }

    @Data
    public static class MetricHistory {
        private List<MetricPoint> cpu;
        private List<MetricPoint> memory;
        private List<MetricPoint> disk;
        private List<NetworkPoint> network; // 网络流量历史
        private int totalPoints;
        private String startTime;
        private String endTime;
    }

    @Data
    public static class NetworkPoint {
        private String time;
        private long in;  // 接收 bytes
        private long out; // 发送 bytes
        
        public NetworkPoint(String time, long in, long out) {
            this.time = time;
            this.in = in;
            this.out = out;
        }
    }

    @Data
    public static class MetricPoint {
        private String time;  // HH:mm 格式
        private double value;
        
        public MetricPoint(String time, double value) {
            this.time = time;
            this.value = value;
        }
    }

    @Data
    public static class Alert {
        private String metric;       // cpu, memory, disk
        private String level;        // warning, critical
        private double currentValue;
        private double threshold;
        private LocalDateTime triggeredAt;
        private String message;
        
        public Alert(String metric, String level, double currentValue, double threshold) {
            this.metric = metric;
            this.level = level;
            this.currentValue = currentValue;
            this.threshold = threshold;
            this.triggeredAt = LocalDateTime.now();
            this.message = String.format("%s 使用率 %.1f%% 超过阈值 %.0f%%", 
                getMetricLabel(metric), currentValue, threshold);
        }
        
        private static String getMetricLabel(String metric) {
            return switch (metric) {
                case "cpu" -> "CPU";
                case "memory" -> "内存";
                case "disk" -> "磁盘";
                default -> metric;
            };
        }
    }

    @Data
    public static class AlertConfig {
        private double cpuThreshold;
        private double memoryThreshold;
        private double diskThreshold;
        private int sustainedCount;
        private int retentionMinutes;
        private int sampleIntervalSeconds;
    }

    @Data
    public static class MonitoringConfig {
        private AlertConfig alertConfig;
        private List<Integer> refreshOptions = List.of(5, 10, 30, 60, 300);  // 秒
        private long historyDataSize;  // 历史数据占用字节
    }

    // ========== 定时采样任务 ==========

    @Scheduled(fixedRateString = "${monitoring.history.sample-interval-seconds:30}000")
    public void collectMetrics() {
        try {
            var metrics = systemMonitorService.getSystemMetrics();
            
            MetricSnapshot snapshot = new MetricSnapshot(
                metrics.getCpuUsage(),
                metrics.getMemoryPercent(),
                metrics.getDiskPercent(),
                metrics.getNetworkIn(),
                metrics.getNetworkOut()
            );
            
            historyQueue.addLast(snapshot);
            
            // 清理过期数据
            cleanupOldData();
            
            // 检查告警
            checkAlerts(snapshot);
            
        } catch (Exception e) {
            log.warn("Failed to collect metrics", e);
        }
    }

    // ========== 公开 API ==========

    /**
     * 获取历史数据 (用于趋势图)
     * @param minutes 获取最近 N 分钟的数据
     * @param maxPoints 最大数据点数 (用于图表采样)
     */
    public MetricHistory getHistory(int minutes, int maxPoints) {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(minutes);
        
        List<MetricSnapshot> filtered = historyQueue.stream()
            .filter(s -> s.getTimestamp().isAfter(cutoff))
            .collect(Collectors.toList());
        
        // 采样以控制数据点数量
        List<MetricSnapshot> sampled = sampleData(filtered, maxPoints);
        
        MetricHistory history = new MetricHistory();
        // 使用 ISO 格式返回完整时间，交由前端格式化
        DateTimeFormatter formatter = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
        
        history.setCpu(sampled.stream()
            .map(s -> new MetricPoint(s.getTimestamp().format(formatter), s.getCpu()))
            .collect(Collectors.toList()));
        
        history.setMemory(sampled.stream()
            .map(s -> new MetricPoint(s.getTimestamp().format(formatter), s.getMemory()))
            .collect(Collectors.toList()));
        
        history.setDisk(sampled.stream()
            .map(s -> new MetricPoint(s.getTimestamp().format(formatter), s.getDisk()))
            .collect(Collectors.toList()));
        
        history.setNetwork(sampled.stream()
            .map(s -> new NetworkPoint(s.getTimestamp().format(formatter), s.getNetworkIn(), s.getNetworkOut()))
            .collect(Collectors.toList()));
        
        history.setTotalPoints(filtered.size());
        
        if (!sampled.isEmpty()) {
            history.setStartTime(sampled.get(0).getTimestamp().format(formatter));
            history.setEndTime(sampled.get(sampled.size() - 1).getTimestamp().format(formatter));
        }
        
        return history;
    }

    /**
     * 获取当前活跃告警
     */
    public List<Alert> getActiveAlerts() {
        return new ArrayList<>(activeAlerts);
    }

    /**
     * 获取监控配置
     */
    public MonitoringConfig getConfig() {
        MonitoringConfig config = new MonitoringConfig();
        
        AlertConfig alertConfig = new AlertConfig();
        alertConfig.setCpuThreshold(cpuThreshold);
        alertConfig.setMemoryThreshold(memoryThreshold);
        alertConfig.setDiskThreshold(diskThreshold);
        alertConfig.setSustainedCount(sustainedCount);
        alertConfig.setRetentionMinutes(retentionMinutes);
        alertConfig.setSampleIntervalSeconds(sampleIntervalSeconds);
        
        config.setAlertConfig(alertConfig);
        config.setHistoryDataSize(estimateHistorySize());
        
        return config;
    }

    /**
     * 清理历史数据
     */
    public int cleanupHistory() {
        int before = historyQueue.size();
        historyQueue.clear();
        alertCounters.clear();
        activeAlerts.clear();
        return before;
    }

    /**
     * 获取历史数据统计
     */
    public Map<String, Object> getHistoryStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalPoints", historyQueue.size());
        stats.put("estimatedSizeBytes", estimateHistorySize());
        stats.put("retentionMinutes", retentionMinutes);
        stats.put("sampleIntervalSeconds", sampleIntervalSeconds);
        
        if (!historyQueue.isEmpty()) {
            stats.put("oldestTimestamp", historyQueue.getFirst().getTimestamp().toString());
            stats.put("newestTimestamp", historyQueue.getLast().getTimestamp().toString());
        }
        
        return stats;
    }

    // ========== 私有方法 ==========

    private void cleanupOldData() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(retentionMinutes);
        while (!historyQueue.isEmpty() && historyQueue.peekFirst().getTimestamp().isBefore(cutoff)) {
            historyQueue.pollFirst();
        }
    }

    private void checkAlerts(MetricSnapshot snapshot) {
        checkMetricAlert("cpu", snapshot.getCpu(), cpuThreshold);
        checkMetricAlert("memory", snapshot.getMemory(), memoryThreshold);
        checkMetricAlert("disk", snapshot.getDisk(), diskThreshold);
    }

    private void checkMetricAlert(String metric, double value, double threshold) {
        if (value >= threshold) {
            int count = alertCounters.getOrDefault(metric, 0) + 1;
            alertCounters.put(metric, count);
            
            // 持续超过阈值才触发告警
            if (count >= sustainedCount && !hasActiveAlert(metric)) {
                String level = value >= threshold + 10 ? "critical" : "warning";
                Alert alert = new Alert(metric, level, value, threshold);
                activeAlerts.add(alert);
                log.warn("[ALERT] {}", alert.getMessage());
            }
        } else {
            // 恢复正常，清除计数器和告警
            alertCounters.put(metric, 0);
            activeAlerts.removeIf(a -> a.getMetric().equals(metric));
        }
    }

    private boolean hasActiveAlert(String metric) {
        return activeAlerts.stream().anyMatch(a -> a.getMetric().equals(metric));
    }

    private List<MetricSnapshot> sampleData(List<MetricSnapshot> data, int maxPoints) {
        if (data.size() <= maxPoints) return data;
        
        List<MetricSnapshot> sampled = new ArrayList<>();
        double step = (double) data.size() / maxPoints;
        
        for (int i = 0; i < maxPoints; i++) {
            int index = (int) (i * step);
            sampled.add(data.get(index));
        }
        
        return sampled;
    }

    private long estimateHistorySize() {
        // 估算每个 MetricSnapshot 约 60 字节
        return historyQueue.size() * 60L;
    }
}
