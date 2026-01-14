package com.aetherblog.blog.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;

import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/**
 * 日志查看服务
 * 
 * @description 读取后端日志文件，支持按级别筛选和下载
 * @ref §8.2 - Dashboard 日志监控
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LogViewerService {

    @Value("${app.log.path:./logs}")
    private String logPath;

    // 日志级别对应的文件名
    private static final Map<String, String> LEVEL_FILE_MAP = Map.of(
        "ALL", "aetherblog.log",
        "INFO", "info.log",
        "WARN", "warn.log",
        "ERROR", "error.log",
        "DEBUG", "debug.log"
    );

    // ========== 数据模型 ==========

    @Data
    public static class LogFileInfo {
        private String level;
        private String filename;
        private long size;
        private String sizeFormatted;
        private boolean exists;
    }

    // ========== 公开方法 ==========

    /**
     * 按级别获取日志 (最后 N 行)
     * 
     * @param level 日志级别 (ALL/INFO/WARN/ERROR/DEBUG)
     * @param lines 行数限制
     * @return 日志行列表
     */
    public List<String> getLogsByLevel(String level, int lines) {
        String filename = LEVEL_FILE_MAP.getOrDefault(level.toUpperCase(), "aetherblog.log");
        Path logFile = Paths.get(logPath, filename);
        
        if (!Files.exists(logFile)) {
            log.warn("Log file not found: {}", logFile);
            return List.of("日志文件不存在: " + filename);
        }
        
        try {
            return readLastLines(logFile, Math.min(lines, 5000)); // 最多 5000 行
        } catch (Exception e) {
            log.error("Failed to read log file: {}", logFile, e);
            return List.of("读取日志失败: " + e.getMessage());
        }
    }

    /**
     * 获取日志文件资源 (用于下载)
     */
    public Resource getLogFileResource(String level) {
        String filename = LEVEL_FILE_MAP.getOrDefault(level.toUpperCase(), "aetherblog.log");
        Path logFile = Paths.get(logPath, filename).toAbsolutePath();
        
        try {
            if (Files.exists(logFile)) {
                return new UrlResource(logFile.toUri());
            }
        } catch (Exception e) {
            log.error("Failed to get log file resource: {}", logFile, e);
        }
        return null;
    }

    /**
     * 获取可用日志文件列表
     */
    public List<LogFileInfo> getAvailableLogFiles() {
        List<LogFileInfo> files = new ArrayList<>();
        
        for (Map.Entry<String, String> entry : LEVEL_FILE_MAP.entrySet()) {
            LogFileInfo info = new LogFileInfo();
            info.setLevel(entry.getKey());
            info.setFilename(entry.getValue());
            
            Path logFile = Paths.get(logPath, entry.getValue());
            if (Files.exists(logFile)) {
                try {
                    long size = Files.size(logFile);
                    info.setSize(size);
                    info.setSizeFormatted(formatBytes(size));
                    info.setExists(true);
                } catch (Exception e) {
                    info.setExists(false);
                }
            } else {
                info.setExists(false);
            }
            
            files.add(info);
        }
        
        return files;
    }

    // ========== 私有方法 ==========

    /**
     * 高效读取文件最后 N 行 (使用 RandomAccessFile 从文件末尾反向读取)
     */
    private List<String> readLastLines(Path file, int lines) throws Exception {
        List<String> result = new ArrayList<>();
        
        try (RandomAccessFile raf = new RandomAccessFile(file.toFile(), "r")) {
            long fileLength = raf.length();
            if (fileLength == 0) {
                return List.of("日志文件为空");
            }
            
            // 从文件末尾开始反向读取
            StringBuilder sb = new StringBuilder();
            long pointer = fileLength - 1;
            int lineCount = 0;
            
            while (pointer >= 0 && lineCount < lines) {
                raf.seek(pointer);
                int c = raf.read();
                
                if (c == '\n') {
                    if (sb.length() > 0) {
                        result.addFirst(sb.reverse().toString());
                        sb.setLength(0);
                        lineCount++;
                    }
                } else if (c != '\r') {
                    sb.append((char) c);
                }
                
                pointer--;
            }
            
            // 处理最后一行 (文件开头的行)
            if (sb.length() > 0 && lineCount < lines) {
                result.addFirst(sb.reverse().toString());
            }
        }
        
        return result;
    }

    private static String formatBytes(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.2f KB", bytes / 1024.0);
        if (bytes < 1024 * 1024 * 1024) return String.format("%.2f MB", bytes / (1024.0 * 1024));
        return String.format("%.2f GB", bytes / (1024.0 * 1024 * 1024));
    }
}
