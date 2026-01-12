package com.aetherblog.blog.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Docker 容器监控服务
 * 
 * @description 通过 Docker Engine API 获取各容器的 CPU/内存使用情况
 * @ref §8.2 - Dashboard 系统监控
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ContainerMonitorService {

    @Value("${docker.host:unix:///var/run/docker.sock}")
    private String dockerHost;
    
    @Value("${docker.api.enabled:true}")
    private boolean dockerApiEnabled;

    // ========== 数据模型 ==========

    @Data
    public static class ContainerMetrics {
        private String id;              // 容器 ID (短)
        private String name;            // 容器名 (aetherblog-backend)
        private String displayName;     // 显示名称 (Backend)
        private String status;          // running/exited/paused
        private String state;           // 状态描述 (Up 2 hours)
        private double cpuPercent;      // CPU 使用率 0-100
        private long memoryUsed;        // 已用内存 bytes
        private long memoryLimit;       // 内存限制 bytes
        private double memoryPercent;   // 内存使用率 0-100
        private String image;           // 镜像名
        private String type;            // 类型: java/nodejs/database/cache/other
    }

    @Data
    public static class ContainerOverview {
        private List<ContainerMetrics> containers;
        private int totalContainers;
        private int runningContainers;
        private long totalMemoryUsed;
        private long totalMemoryLimit;
        private double avgCpuPercent;
        private boolean dockerAvailable;
        private String errorMessage;
    }

    // ========== 公开方法 ==========

    /**
     * 获取所有 AetherBlog 相关容器的指标
     */
    public ContainerOverview getContainerMetrics() {
        ContainerOverview overview = new ContainerOverview();
        overview.setContainers(new ArrayList<>());
        
        if (!dockerApiEnabled) {
            overview.setDockerAvailable(false);
            overview.setErrorMessage("Docker API 已禁用");
            return overview;
        }

        try {
            // 使用 docker stats 命令获取容器统计信息
            List<ContainerMetrics> metrics = getContainerStatsViaCommand();
            
            overview.setContainers(metrics);
            overview.setDockerAvailable(true);
            overview.setTotalContainers(metrics.size());
            overview.setRunningContainers((int) metrics.stream()
                .filter(m -> "running".equals(m.getStatus()))
                .count());
            
            // 计算汇总
            long totalMem = 0;
            long totalLimit = 0;
            double totalCpu = 0;
            
            for (ContainerMetrics m : metrics) {
                totalMem += m.getMemoryUsed();
                totalLimit += m.getMemoryLimit();
                totalCpu += m.getCpuPercent();
            }
            
            overview.setTotalMemoryUsed(totalMem);
            overview.setTotalMemoryLimit(totalLimit);
            overview.setAvgCpuPercent(metrics.isEmpty() ? 0 : totalCpu / metrics.size());
            
        } catch (Exception e) {
            log.warn("Failed to get container metrics: {}", e.getMessage());
            overview.setDockerAvailable(false);
            overview.setErrorMessage(e.getMessage());
        }
        
        return overview;
    }

    // ========== 私有方法 ==========

    /**
     * 通过 docker stats 命令获取容器统计
     * 命令输出格式: CONTAINER ID   NAME   CPU %   MEM USAGE / LIMIT   MEM %   ...
     */
    private List<ContainerMetrics> getContainerStatsViaCommand() throws Exception {
        List<ContainerMetrics> result = new ArrayList<>();
        
        // 先获取容器列表 (只匹配 aetherblog 相关容器)
        ProcessBuilder listPb = new ProcessBuilder(
            "docker", "ps", "--format", "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}"
        );
        listPb.redirectErrorStream(true);
        Process listProcess = listPb.start();
        
        List<String[]> containerInfos = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(listProcess.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String[] parts = line.split("\\|");
                if (parts.length >= 4) {
                    String name = parts[1];
                    // 只处理 aetherblog 相关容器
                    if (name.contains("aetherblog")) {
                        containerInfos.add(parts);
                    }
                }
            }
        }
        listProcess.waitFor();
        
        if (containerInfos.isEmpty()) {
            log.debug("No aetherblog containers found");
            return result;
        }
        
        // 获取容器 ID 列表
        List<String> containerIds = containerInfos.stream()
            .map(parts -> parts[0])
            .toList();
        
        // 使用 docker stats 获取实时统计
        List<String> statsCmd = new ArrayList<>();
        statsCmd.add("docker");
        statsCmd.add("stats");
        statsCmd.add("--no-stream");
        statsCmd.add("--format");
        statsCmd.add("{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}");
        statsCmd.addAll(containerIds);
        
        ProcessBuilder statsPb = new ProcessBuilder(statsCmd);
        statsPb.redirectErrorStream(true);
        Process statsProcess = statsPb.start();
        
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(statsProcess.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String[] parts = line.split("\\|");
                if (parts.length >= 4) {
                    String id = parts[0];
                    
                    // 找到对应的容器信息
                    String[] info = containerInfos.stream()
                        .filter(i -> i[0].startsWith(id) || id.startsWith(i[0]))
                        .findFirst()
                        .orElse(null);
                    
                    if (info != null) {
                        ContainerMetrics metrics = new ContainerMetrics();
                        metrics.setId(id);
                        metrics.setName(info[1]);
                        metrics.setDisplayName(getDisplayName(info[1]));
                        metrics.setStatus("running");
                        metrics.setState(info[2]);
                        metrics.setImage(info[3]);
                        metrics.setType(getContainerType(info[1], info[3]));
                        
                        // 解析 CPU%
                        metrics.setCpuPercent(parsePercent(parts[1]));
                        
                        // 解析 MEM USAGE / LIMIT (例如: "450MiB / 1.5GiB")
                        parseMemoryUsage(parts[2], metrics);
                        
                        // 解析 MEM %
                        metrics.setMemoryPercent(parsePercent(parts[3]));
                        
                        result.add(metrics);
                    }
                }
            }
        }
        statsProcess.waitFor();
        
        // 按类型排序: java -> nodejs -> database -> cache -> other
        result.sort((a, b) -> {
            int orderA = getTypeOrder(a.getType());
            int orderB = getTypeOrder(b.getType());
            return Integer.compare(orderA, orderB);
        });
        
        return result;
    }

    /**
     * 解析百分比字符串 (例如: "12.34%" -> 12.34)
     */
    private double parsePercent(String str) {
        try {
            return Double.parseDouble(str.replace("%", "").trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * 解析内存使用字符串 (例如: "450MiB / 1.5GiB")
     */
    private void parseMemoryUsage(String str, ContainerMetrics metrics) {
        try {
            String[] parts = str.split("/");
            if (parts.length >= 2) {
                metrics.setMemoryUsed(parseMemoryValue(parts[0].trim()));
                metrics.setMemoryLimit(parseMemoryValue(parts[1].trim()));
            }
        } catch (Exception e) {
            log.debug("Failed to parse memory usage: {}", str);
        }
    }

    /**
     * 解析内存值 (例如: "450MiB" -> 471859200, "1.5GiB" -> 1610612736)
     */
    private long parseMemoryValue(String str) {
        Pattern pattern = Pattern.compile("([\\d.]+)\\s*([A-Za-z]+)");
        Matcher matcher = pattern.matcher(str);
        
        if (matcher.find()) {
            double value = Double.parseDouble(matcher.group(1));
            String unit = matcher.group(2).toUpperCase();
            
            return switch (unit) {
                case "B" -> (long) value;
                case "KB", "KIB" -> (long) (value * 1024);
                case "MB", "MIB" -> (long) (value * 1024 * 1024);
                case "GB", "GIB" -> (long) (value * 1024 * 1024 * 1024);
                default -> (long) value;
            };
        }
        return 0;
    }

    /**
     * 获取容器显示名称
     */
    private String getDisplayName(String name) {
        if (name.contains("backend")) return "Backend (Java)";
        if (name.endsWith("-blog") || name.equals("aetherblog")) return "Blog (Node.js)";
        if (name.contains("admin")) return "Admin (Nginx)";
        if (name.contains("postgres")) return "PostgreSQL";
        if (name.contains("redis")) return "Redis";
        if (name.contains("elasticsearch")) return "Elasticsearch";
        if (name.contains("gateway")) return "Gateway (Nginx)";
        if (name.contains("buildx")) return "Builder";
        return name;
    }

    /**
     * 获取容器类型
     */
    private String getContainerType(String name, String image) {
        if (name.contains("backend") || image.contains("java") || image.contains("spring")) return "java";
        if ((name.endsWith("-blog") || name.equals("aetherblog")) && image.contains("node")) return "nodejs";
        if (name.contains("admin") || image.contains("nginx")) return "nginx";
        if (name.contains("postgres") || image.contains("postgres")) return "database";
        if (name.contains("redis") || image.contains("redis")) return "cache";
        if (name.contains("elasticsearch") || image.contains("elastic")) return "search";
        return "other";
    }

    /**
     * 获取类型排序顺序
     */
    private int getTypeOrder(String type) {
        return switch (type) {
            case "java" -> 1;
            case "nodejs" -> 2;
            case "nginx" -> 3;
            case "database" -> 4;
            case "cache" -> 5;
            case "search" -> 6;
            default -> 10;
        };
    }
}
