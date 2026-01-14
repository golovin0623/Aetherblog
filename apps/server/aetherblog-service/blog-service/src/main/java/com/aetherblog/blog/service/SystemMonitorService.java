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
        private int cpuCores;          // CPU 核心数
        private String cpuModel;       // CPU 型号
        private long cpuFrequency;     // CPU 频率 (Hz)
        private long memoryUsed;       // bytes
        private long memoryTotal;      // bytes
        private double memoryPercent;  // 0-100
        private long diskUsed;         // bytes
        private long diskTotal;        // bytes
        private double diskPercent;    // 0-100
        private long networkIn;        // bytes 累计接收
        private long networkOut;       // bytes 累计发送
        private String networkInRate;  // 接收速率 (格式化)
        private String networkOutRate; // 发送速率 (格式化)
        private long uptime;           // seconds
        private String osName;         // 操作系统名称
        private String osArch;         // 系统架构
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

        // CPU 核心数
        metrics.setCpuCores(processors);

        // 操作系统信息
        metrics.setOsName(osBean.getName());
        metrics.setOsArch(osBean.getArch());

        // 获取 CPU 型号和频率
        try {
            CpuInfo cpuInfo = getCpuInfo();
            metrics.setCpuModel(cpuInfo.model);
            metrics.setCpuFrequency(cpuInfo.frequency);
        } catch (Exception e) {
            log.debug("Failed to get CPU info", e);
            metrics.setCpuModel("Unknown");
            metrics.setCpuFrequency(0);
        }

        // 如果是 com.sun.management.OperatingSystemMXBean，获取更精确的 CPU
        if (osBean instanceof com.sun.management.OperatingSystemMXBean sunOsBean) {
            double cpuUsage = sunOsBean.getCpuLoad() * 100;
            if (cpuUsage >= 0) {
                metrics.setCpuUsage(cpuUsage);
            }
        }

        // 系统内存 - 优先从宿主机 /host_proc 读取 (Docker环境)
        try {
            long[] hostMemory = getHostMemoryInfo();
            if (hostMemory != null && hostMemory[0] > 0) {
                long totalMem = hostMemory[0];
                long availableMem = hostMemory[1];
                long usedMem = Math.max(0, totalMem - availableMem);
                
                metrics.setMemoryTotal(totalMem);
                metrics.setMemoryUsed(usedMem);
                double memPercent = totalMem > 0 ? (double) usedMem / totalMem * 100 : 0;
                metrics.setMemoryPercent(Math.max(0, Math.min(100, memPercent)));
            } else {
                throw new RuntimeException("Host memory not available");
            }
        } catch (Exception e) {
            log.debug("Failed to get host memory, falling back to container memory", e);
            // 回退到容器级别内存（作为降级方案）
            if (osBean instanceof com.sun.management.OperatingSystemMXBean sunOsBean) {
                long totalMem = sunOsBean.getTotalMemorySize();
                long availableMem = getAvailableMemory(totalMem);
                availableMem = Math.min(availableMem, totalMem);
                long usedMem = Math.max(0, totalMem - availableMem);

                metrics.setMemoryTotal(totalMem);
                metrics.setMemoryUsed(usedMem);
                double memPercent = totalMem > 0 ? (double) usedMem / totalMem * 100 : 0;
                metrics.setMemoryPercent(Math.max(0, Math.min(100, memPercent)));
            }
        }

        // 磁盘使用率 - 使用 getUsableSpace 而非 getFreeSpace（更准确）
        File root = new File("/");
        if (root.exists()) {
            long totalSpace = root.getTotalSpace();
            // getUsableSpace() 返回的是当前用户可实际使用的空间（排除系统保留）
            long usableSpace = root.getUsableSpace();
            long usedSpace = totalSpace - usableSpace;
            metrics.setDiskTotal(totalSpace);
            metrics.setDiskUsed(usedSpace);
            metrics.setDiskPercent((double) usedSpace / totalSpace * 100);
        }

        // 网络流量统计
        try {
            long[] networkStats = getNetworkStats();
            metrics.setNetworkIn(networkStats[0]);
            metrics.setNetworkOut(networkStats[1]);
            metrics.setNetworkInRate(formatBytes(networkStats[0]) + " 累计接收");
            metrics.setNetworkOutRate(formatBytes(networkStats[1]) + " 累计发送");
        } catch (Exception e) {
            log.debug("Failed to get network stats", e);
            metrics.setNetworkIn(0);
            metrics.setNetworkOut(0);
            metrics.setNetworkInRate("N/A");
            metrics.setNetworkOutRate("N/A");
        }

        // 系统运行时间
        long uptime = ManagementFactory.getRuntimeMXBean().getUptime() / 1000;
        metrics.setUptime(uptime);

        return metrics;
    }

    // CPU 信息内部类
    private record CpuInfo(String model, long frequency) {}

    /**
     * 获取 CPU 型号和频率
     * macOS: 使用 sysctl 命令
     * Linux: 读取 /proc/cpuinfo
     */
    private CpuInfo getCpuInfo() throws Exception {
        String osName = System.getProperty("os.name").toLowerCase();

        if (osName.contains("mac")) {
            return getCpuInfoMacOS();
        } else if (osName.contains("linux")) {
            return getCpuInfoLinux();
        }

        return new CpuInfo("Unknown", 0);
    }

    /**
     * macOS: 使用 sysctl 获取 CPU 信息
     */
    private CpuInfo getCpuInfoMacOS() throws Exception {
        String model = "Unknown";
        long frequency = 0;

        // 方案1: 尝试 machdep.cpu.brand_string (Intel Mac)
        ProcessBuilder pbModel = new ProcessBuilder("sysctl", "-n", "machdep.cpu.brand_string");
        Process processModel = pbModel.start();
        String modelOutput = new String(processModel.getInputStream().readAllBytes()).trim();
        processModel.waitFor();

        if (!modelOutput.isEmpty()) {
            model = modelOutput;
            // Intel Mac: 获取频率
            ProcessBuilder pbFreq = new ProcessBuilder("sysctl", "-n", "hw.cpufrequency");
            Process processFreq = pbFreq.start();
            String freqOutput = new String(processFreq.getInputStream().readAllBytes()).trim();
            processFreq.waitFor();
            if (!freqOutput.isEmpty()) {
                try {
                    frequency = Long.parseLong(freqOutput);
                } catch (NumberFormatException ignored) {}
            }
        } else {
            // 方案2: Apple Silicon - 使用 system_profiler
            ProcessBuilder pbProfiler = new ProcessBuilder("system_profiler", "SPHardwareDataType");
            Process processProfiler = pbProfiler.start();
            String profilerOutput = new String(processProfiler.getInputStream().readAllBytes());
            processProfiler.waitFor();

            for (String line : profilerOutput.split("\n")) {
                line = line.trim();
                if (line.startsWith("Chip:")) {
                    model = line.substring(5).trim();
                } else if (line.startsWith("Processor Name:")) {
                    model = line.substring(15).trim();
                }
            }
        }

        // 如果获取不到频率，尝试从型号中解析
        if (frequency == 0 && model.contains("GHz")) {
            frequency = parseFrequencyFromModel(model);
        }

        // Apple Silicon 没有固定频率，返回 0 让前端显示 "动态" 或不显示频率
        return new CpuInfo(model, frequency);
    }

    /**
     * Linux: 从 /proc/cpuinfo 读取 CPU 信息
     */
    private CpuInfo getCpuInfoLinux() throws Exception {
        Path cpuinfo = Paths.get("/proc/cpuinfo");
        String model = "Unknown";
        long frequency = 0;

        for (String line : Files.readAllLines(cpuinfo)) {
            if (line.startsWith("model name")) {
                // 格式: "model name	: Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz"
                String[] parts = line.split(":");
                if (parts.length >= 2) {
                    model = parts[1].trim();
                }
            } else if (line.startsWith("cpu MHz")) {
                // 格式: "cpu MHz		: 2600.000"
                String[] parts = line.split(":");
                if (parts.length >= 2) {
                    try {
                        double mhz = Double.parseDouble(parts[1].trim());
                        frequency = (long) (mhz * 1_000_000); // 转换为 Hz
                    } catch (NumberFormatException ignored) {}
                }
            }

            // 找到两个值后就可以退出
            if (!model.equals("Unknown") && frequency > 0) {
                break;
            }
        }

        return new CpuInfo(model, frequency);
    }

    /**
     * 从 CPU 型号字符串中解析频率
     * 例如: "Apple M1 Pro" 或 "Intel Core i7 @ 2.6GHz"
     */
    private long parseFrequencyFromModel(String model) {
        // 匹配 "X.XX GHz" 或 "X GHz" 模式
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("(\\d+\\.?\\d*)\\s*GHz", java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Matcher matcher = pattern.matcher(model);
        if (matcher.find()) {
            try {
                double ghz = Double.parseDouble(matcher.group(1));
                return (long) (ghz * 1_000_000_000); // 转换为 Hz
            } catch (NumberFormatException ignored) {}
        }
        return 0;
    }

    /**
     * 获取网络流量统计
     * macOS: 使用 netstat 命令
     * Linux: 读取 /proc/net/dev
     */
    private long[] getNetworkStats() throws Exception {
        String osName = System.getProperty("os.name").toLowerCase();

        if (osName.contains("linux")) {
            return getNetworkStatsLinux();
        } else if (osName.contains("mac")) {
            return getNetworkStatsMacOS();
        }

        return new long[]{0, 0};
    }

    /**
     * Linux: 从 /proc/net/dev 读取网络统计
     */
    private long[] getNetworkStatsLinux() throws Exception {
        Path netDev = Paths.get("/proc/net/dev");
        long totalIn = 0, totalOut = 0;

        for (String line : Files.readAllLines(netDev)) {
            line = line.trim();
            // 跳过 lo (本地回环) 和标题行
            if (line.startsWith("lo:") || !line.contains(":")) continue;

            String[] parts = line.split("\\s+");
            if (parts.length >= 10) {
                String iface = parts[0].replace(":", "");
                // 只统计 eth/ens/enp 等网络接口
                if (iface.startsWith("eth") || iface.startsWith("ens") || iface.startsWith("enp") || iface.startsWith("wlan")) {
                    totalIn += Long.parseLong(parts[1]);   // 接收字节
                    totalOut += Long.parseLong(parts[9]);  // 发送字节
                }
            }
        }

        return new long[]{totalIn, totalOut};
    }

    /**
     * macOS: 使用 netstat 获取网络统计
     */
    private long[] getNetworkStatsMacOS() throws Exception {
        ProcessBuilder pb = new ProcessBuilder("netstat", "-ib");
        Process process = pb.start();
        String output = new String(process.getInputStream().readAllBytes());
        process.waitFor();

        long totalIn = 0, totalOut = 0;
        boolean headerPassed = false;

        for (String line : output.split("\n")) {
            if (line.startsWith("Name")) {
                headerPassed = true;
                continue;
            }
            if (!headerPassed) continue;

            String[] parts = line.trim().split("\\s+");
            // 格式: Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
            if (parts.length >= 10) {
                String iface = parts[0];
                // 只统计 en 开头的物理网络接口
                if (iface.startsWith("en")) {
                    try {
                        totalIn += Long.parseLong(parts[6]);   // Ibytes
                        totalOut += Long.parseLong(parts[9]);  // Obytes
                    } catch (NumberFormatException ignored) {}
                }
            }
        }

        return new long[]{totalIn, totalOut};
    }

    /**
     * 获取可用内存（考虑缓存可回收部分）
     * macOS: 使用 vm_stat 命令
     * Linux: 使用 /proc/meminfo
     * 其他: 回退到 JVM API
     */
    private long getAvailableMemory(long totalMem) {
        String osName = System.getProperty("os.name").toLowerCase();

        try {
            if (osName.contains("mac")) {
                return getAvailableMemoryMacOS(totalMem);
            } else if (osName.contains("linux")) {
                return getAvailableMemoryLinux();
            }
        } catch (Exception e) {
            log.debug("Failed to get available memory via system command, falling back to JVM API", e);
        }

        // 回退：使用 JVM API（不准确但可用）
        if (ManagementFactory.getOperatingSystemMXBean() instanceof com.sun.management.OperatingSystemMXBean sunOsBean) {
            return sunOsBean.getFreeMemorySize();
        }
        return totalMem / 4; // 默认假设25%可用
    }

    /**
     * macOS: 使用 vm_stat 获取可用内存
     * 可用内存 ≈ free + inactive + file cache (purgeable)
     */
    private long getAvailableMemoryMacOS(long totalMem) throws Exception {
        ProcessBuilder pb = new ProcessBuilder("vm_stat");
        Process process = pb.start();
        String output = new String(process.getInputStream().readAllBytes());
        process.waitFor();

        long pageSize = 4096; // macOS 默认页大小
        long freePages = 0;
        long inactivePages = 0;
        long purgeablePages = 0;
        long speculativePages = 0;

        for (String line : output.split("\n")) {
            if (line.contains("page size of")) {
                // 解析页大小: "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
                String[] parts = line.split("page size of ");
                if (parts.length > 1) {
                    pageSize = Long.parseLong(parts[1].replaceAll("[^0-9]", ""));
                }
            } else if (line.startsWith("Pages free:")) {
                freePages = parseMacVmStatValue(line);
            } else if (line.startsWith("Pages inactive:")) {
                inactivePages = parseMacVmStatValue(line);
            } else if (line.startsWith("Pages purgeable:")) {
                purgeablePages = parseMacVmStatValue(line);
            } else if (line.startsWith("Pages speculative:")) {
                speculativePages = parseMacVmStatValue(line);
            }
        }

        // 可用内存 = (free + inactive + speculative + purgeable) * pageSize
        long availablePages = freePages + inactivePages + speculativePages + purgeablePages;
        return availablePages * pageSize;
    }

    private long parseMacVmStatValue(String line) {
        // 解析格式: "Pages free:                             1234."
        String value = line.split(":")[1].trim().replace(".", "");
        return Long.parseLong(value);
    }

    /**
     * Linux: 从 /proc/meminfo 读取 MemAvailable
     */
    private long getAvailableMemoryLinux() throws Exception {
        // 优先从容器级别 /proc/meminfo 读取（作为降级方案）
        Path meminfo = Paths.get("/proc/meminfo");
        for (String line : Files.readAllLines(meminfo)) {
            if (line.startsWith("MemAvailable:")) {
                // 格式: "MemAvailable:    1234567 kB"
                String[] parts = line.split("\\s+");
                long valueKB = Long.parseLong(parts[1]);
                return valueKB * 1024; // 转换为字节
            }
        }
        throw new RuntimeException("MemAvailable not found in /proc/meminfo");
    }

    /**
     * 从宿主机 /host_proc/meminfo 读取内存信息 (Docker环境)
     * @return [totalMemory, availableMemory] in bytes, or null if not available
     */
    private long[] getHostMemoryInfo() {
        // 直接挂载文件: /proc/meminfo:/host_proc/meminfo:ro
        Path hostMeminfo = Paths.get("/host_proc/meminfo");
        if (!Files.exists(hostMeminfo)) {
            log.debug("/host_proc/meminfo not found, host meminfo not mounted");
            return null;
        }
        
        try {
            long totalMem = 0;
            long availableMem = 0;
            
            for (String line : Files.readAllLines(hostMeminfo)) {
                if (line.startsWith("MemTotal:")) {
                    String[] parts = line.split("\\s+");
                    totalMem = Long.parseLong(parts[1]) * 1024; // kB -> bytes
                } else if (line.startsWith("MemAvailable:")) {
                    String[] parts = line.split("\\s+");
                    availableMem = Long.parseLong(parts[1]) * 1024; // kB -> bytes
                }
            }
            
            if (totalMem > 0) {
                log.debug("Read host memory: total={}, available={}", 
                    formatBytes(totalMem), formatBytes(availableMem));
                return new long[]{totalMem, availableMem};
            }
        } catch (Exception e) {
            log.warn("Failed to read /host_proc/meminfo", e);
        }
        
        return null;
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

        // 并行检查各服务 (使用结构化并发 + 虚拟线程)
        // Create a virtual thread executor
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var pgFuture = java.util.concurrent.CompletableFuture.supplyAsync(this::checkPostgreSQL, executor);
            var redisFuture = java.util.concurrent.CompletableFuture.supplyAsync(this::checkRedis, executor);
            var esFuture = java.util.concurrent.CompletableFuture.supplyAsync(this::checkElasticsearch, executor);

            try {
                // Wait for all tasks to complete with a timeout
                java.util.concurrent.CompletableFuture.allOf(pgFuture, redisFuture, esFuture)
                        .get(5, java.util.concurrent.TimeUnit.SECONDS);

                services.add(pgFuture.get());
                services.add(redisFuture.get());
                services.add(esFuture.get());
            } catch (Exception e) {
                log.warn("Health check timeout or interrupted", e);
                // Even if timeout/error, try to get results that finished (optimistic)
                // Or just proceed. The checks capture their own exceptions so futures should complete successfully returning a 'down' status object.
                // If future.get() throws, it means the task crashed unexpectedly or timeout.
                if (!pgFuture.isCompletedExceptionally() && pgFuture.isDone()) services.add(pgFuture.join());
                if (!redisFuture.isCompletedExceptionally() && redisFuture.isDone()) services.add(redisFuture.join());
                if (!esFuture.isCompletedExceptionally() && esFuture.isDone()) services.add(esFuture.join());
            }
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
        Path dir = Paths.get(path).toAbsolutePath();
        long[] result = {0, 0}; // [size, count]

        try {
            // 尝试多个可能的日志目录
            if (!Files.exists(dir) && name.contains("日志")) {
                // 尝试备用日志路径：1.配置路径 2.应用目录 3.常见Docker路径 4.容器应用路径
                String[] fallbackPaths = {
                    logPath,
                    System.getProperty("user.dir") + "/logs",
                    "/app/logs",
                    "/logs",
                    "./logs",
                    System.getProperty("java.io.tmpdir") + "/aetherblog-logs"
                };
                for (String fallback : fallbackPaths) {
                    if (fallback == null || fallback.isEmpty()) continue;
                    Path fallbackDir = Paths.get(fallback).toAbsolutePath();
                    if (Files.exists(fallbackDir)) {
                        dir = fallbackDir;
                        log.debug("Found active log path at: {}", dir);
                        break;
                    }
                }
            }

            if (Files.exists(dir)) {
                Files.walk(dir)
                    .filter(Files::isRegularFile)
                    .forEach(file -> {
                        try {
                            result[0] += Files.size(file);
                            result[1]++;
                        } catch (Exception ignored) {}
                    });
            } else {
                log.warn("Directory does not exist, returning 0: {}", path);
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
