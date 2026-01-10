package com.aetherblog.blog.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.File;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.OperatingSystemMXBean;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * 系统监控服务
 * 
 * @description 提供系统运行时指标、存储统计、服务健康检查
 * @ref §8.2 - Dashboard 系统监控
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SystemMonitorService {

    private final DataSource dataSource;
    private final RedisConnectionFactory redisConnectionFactory;
    
    @Value("${app.upload.path:./uploads}")
    private String uploadPath;
    
    @Value("${app.log.path:./logs}")
    private String logPath;

    // ========== 数据模型 ==========
    
    @Data
    public static class SystemMetrics {
        private double cpuUsage;       // 0-100
        private long memoryUsed;       // bytes
        private long memoryTotal;      // bytes
        private double memoryPercent;  // 0-100
        private long diskUsed;         // bytes
        private long diskTotal;        // bytes
        private double diskPercent;    // 0-100
        private long jvmHeapUsed;      // bytes
        private long jvmHeapMax;       // bytes
        private double jvmPercent;     // 0-100
        private long uptime;           // seconds
    }

    @Data
    public static class StorageDetails {
        private StorageItem uploads;
        private StorageItem database;
        private StorageItem logs;
        private long totalSize;
        private long usedSize;
        private double usedPercent;
    }

    @Data
    public static class StorageItem {
        private String name;
        private long size;          // bytes
        private long fileCount;
        private String formatted;   // "2.5 GB"
        
        public StorageItem(String name, long size, long fileCount) {
            this.name = name;
            this.size = size;
            this.fileCount = fileCount;
            this.formatted = formatBytes(size);
        }
    }

    @Data
    public static class ServiceHealth {
        private String name;
        private String status;      // "up" | "down" | "warning"
        private long latency;       // ms
        private String message;
        private Map<String, Object> details;
        
        public ServiceHealth(String name, String status, long latency, String message) {
            this.name = name;
            this.status = status;
            this.latency = latency;
            this.message = message;
        }
    }

    @Data
    public static class MonitorOverview {
        private SystemMetrics metrics;
        private StorageDetails storage;
        private List<ServiceHealth> services;
    }

    // ========== 公开方法 ==========

    /**
     * 获取系统指标
     */
    public SystemMetrics getSystemMetrics() {
        SystemMetrics metrics = new SystemMetrics();
        
        // CPU 使用率
        OperatingSystemMXBean osBean = ManagementFactory.getOperatingSystemMXBean();
        double cpuLoad = osBean.getSystemLoadAverage();
        int processors = osBean.getAvailableProcessors();
        // 将负载转换为百分比 (近似)
        metrics.setCpuUsage(Math.min(100, Math.max(0, (cpuLoad / processors) * 100)));
        
        // 如果是 com.sun.management.OperatingSystemMXBean，获取更精确的 CPU
        if (osBean instanceof com.sun.management.OperatingSystemMXBean sunOsBean) {
            double cpuUsage = sunOsBean.getCpuLoad() * 100;
            if (cpuUsage >= 0) {
                metrics.setCpuUsage(cpuUsage);
            }
        }
        
        // 系统内存
        if (osBean instanceof com.sun.management.OperatingSystemMXBean sunOsBean) {
            long totalMem = sunOsBean.getTotalMemorySize();
            long freeMem = sunOsBean.getFreeMemorySize();
            long usedMem = totalMem - freeMem;
            metrics.setMemoryTotal(totalMem);
            metrics.setMemoryUsed(usedMem);
            metrics.setMemoryPercent((double) usedMem / totalMem * 100);
        }
        
        // 磁盘使用率 (根目录)
        File root = new File("/");
        if (root.exists()) {
            long totalSpace = root.getTotalSpace();
            long freeSpace = root.getFreeSpace();
            long usedSpace = totalSpace - freeSpace;
            metrics.setDiskTotal(totalSpace);
            metrics.setDiskUsed(usedSpace);
            metrics.setDiskPercent((double) usedSpace / totalSpace * 100);
        }
        
        // JVM 堆内存
        MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
        long heapUsed = memoryBean.getHeapMemoryUsage().getUsed();
        long heapMax = memoryBean.getHeapMemoryUsage().getMax();
        metrics.setJvmHeapUsed(heapUsed);
        metrics.setJvmHeapMax(heapMax);
        metrics.setJvmPercent((double) heapUsed / heapMax * 100);
        
        // 系统运行时间
        long uptime = ManagementFactory.getRuntimeMXBean().getUptime() / 1000;
        metrics.setUptime(uptime);
        
        return metrics;
    }

    /**
     * 获取存储明细
     */
    public StorageDetails getStorageDetails() {
        StorageDetails details = new StorageDetails();
        
        // 上传文件目录
        details.setUploads(calculateDirectorySize(uploadPath, "上传文件"));
        
        // 日志目录
        details.setLogs(calculateDirectorySize(logPath, "日志文件"));
        
        // 数据库大小 (尝试查询 PostgreSQL)
        details.setDatabase(getDatabaseSize());
        
        // 计算总计
        long totalUsed = details.getUploads().getSize() 
            + details.getLogs().getSize() 
            + details.getDatabase().getSize();
        details.setUsedSize(totalUsed);
        
        // 获取磁盘总容量
        File root = new File("/");
        if (root.exists()) {
            details.setTotalSize(root.getTotalSpace());
            details.setUsedPercent((double) totalUsed / root.getTotalSpace() * 100);
        }
        
        return details;
    }

    /**
     * 获取服务健康状态
     */
    public List<ServiceHealth> getServicesHealth() {
        List<ServiceHealth> services = new ArrayList<>();
        
        // 并行检查各服务
        CompletableFuture<ServiceHealth> pgFuture = CompletableFuture.supplyAsync(this::checkPostgreSQL);
        CompletableFuture<ServiceHealth> redisFuture = CompletableFuture.supplyAsync(this::checkRedis);
        CompletableFuture<ServiceHealth> esFuture = CompletableFuture.supplyAsync(this::checkElasticsearch);
        
        try {
            services.add(pgFuture.get(5, TimeUnit.SECONDS));
            services.add(redisFuture.get(5, TimeUnit.SECONDS));
            services.add(esFuture.get(5, TimeUnit.SECONDS));
        } catch (Exception e) {
            log.warn("Health check timeout", e);
        }
        
        // API Gateway (自身)
        services.add(0, new ServiceHealth("API Gateway", "up", 1, "运行正常"));
        
        return services;
    }

    /**
     * 获取完整监控概览
     */
    public MonitorOverview getMonitorOverview() {
        MonitorOverview overview = new MonitorOverview();
        overview.setMetrics(getSystemMetrics());
        overview.setStorage(getStorageDetails());
        overview.setServices(getServicesHealth());
        return overview;
    }

    // ========== 私有方法 ==========

    private StorageItem calculateDirectorySize(String path, String name) {
        Path dir = Paths.get(path);
        long[] result = {0, 0}; // [size, count]
        
        try {
            if (Files.exists(dir)) {
                Files.walk(dir)
                    .filter(Files::isRegularFile)
                    .forEach(file -> {
                        try {
                            result[0] += Files.size(file);
                            result[1]++;
                        } catch (Exception ignored) {}
                    });
            }
        } catch (Exception e) {
            log.warn("Failed to calculate directory size: {}", path, e);
        }
        
        return new StorageItem(name, result[0], result[1]);
    }

    private StorageItem getDatabaseSize() {
        long size = 0;
        try (Connection conn = dataSource.getConnection()) {
            var stmt = conn.createStatement();
            var rs = stmt.executeQuery(
                "SELECT pg_database_size(current_database())"
            );
            if (rs.next()) {
                size = rs.getLong(1);
            }
        } catch (Exception e) {
            log.warn("Failed to get database size", e);
        }
        return new StorageItem("数据库", size, 0);
    }

    private ServiceHealth checkPostgreSQL() {
        long start = System.currentTimeMillis();
        try (Connection conn = dataSource.getConnection()) {
            var stmt = conn.createStatement();
            stmt.execute("SELECT 1");
            long latency = System.currentTimeMillis() - start;
            return new ServiceHealth("PostgreSQL", "up", latency, "连接正常");
        } catch (Exception e) {
            return new ServiceHealth("PostgreSQL", "down", 0, e.getMessage());
        }
    }

    private ServiceHealth checkRedis() {
        long start = System.currentTimeMillis();
        try {
            var conn = redisConnectionFactory.getConnection();
            conn.ping();
            conn.close();
            long latency = System.currentTimeMillis() - start;
            return new ServiceHealth("Redis", "up", latency, "连接正常");
        } catch (Exception e) {
            return new ServiceHealth("Redis", "down", 0, e.getMessage());
        }
    }

    private ServiceHealth checkElasticsearch() {
        // ES 检查 - 目前返回 warning 状态 (单节点模式)
        // TODO: 集成 ES RestHighLevelClient 后可动态检查
        return new ServiceHealth("Elasticsearch", "warning", 50, "单节点模式 (Yellow)");
    }

    private static String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        DecimalFormat df = new DecimalFormat("#.##");
        if (bytes < 1024 * 1024) return df.format(bytes / 1024.0) + " KB";
        if (bytes < 1024 * 1024 * 1024) return df.format(bytes / (1024.0 * 1024)) + " MB";
        return df.format(bytes / (1024.0 * 1024 * 1024)) + " GB";
    }
}
