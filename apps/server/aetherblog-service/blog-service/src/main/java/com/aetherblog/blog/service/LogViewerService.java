package com.aetherblog.blog.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;

import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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

    private static final int DEFAULT_LINES = 2000;
    private static final int MAX_LINES = 5000;

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

    @Data
    public static class LogReadResult {
        private final List<String> logs;
        private final String status;
        private final String message;
        private final String errorCategory;

        public boolean isError() {
            return "ERROR".equals(status);
        }

        public boolean isNoData() {
            return "NO_DATA".equals(status);
        }

        public static LogReadResult ok(List<String> logs) {
            return new LogReadResult(logs, "OK", null, null);
        }

        public static LogReadResult noData(String message, String errorCategory) {
            return new LogReadResult(Collections.emptyList(), "NO_DATA", message, errorCategory);
        }

        public static LogReadResult error(String message, String errorCategory) {
            return new LogReadResult(Collections.emptyList(), "ERROR", message, errorCategory);
        }
    }

    // ========== 公开方法 ==========

    /**
     * 按级别获取日志 (最后 N 行)
     *
     * @param level 日志级别 (ALL/INFO/WARN/ERROR/DEBUG)
     * @param lines 行数限制
     * @return 日志读取结果
     */
    public LogReadResult queryLogsByLevel(String level, int lines) {
        String normalizedLevel = normalizeLevel(level);
        int normalizedLines = normalizeLines(lines);
        String filename = LEVEL_FILE_MAP.getOrDefault(normalizedLevel, "aetherblog.log");
        Path logFile = Paths.get(logPath, filename);

        if (!Files.exists(logFile)) {
            log.info("Log file not found: {}", logFile);
            return LogReadResult.noData("日志文件不存在", "LOG_FILE_NOT_FOUND");
        }

        try {
            List<String> logs = readLastLines(logFile, normalizedLines);
            if (logs.isEmpty()) {
                return LogReadResult.noData("日志文件为空", "LOG_FILE_EMPTY");
            }
            return LogReadResult.ok(logs);
        } catch (Exception e) {
            log.error("Failed to read log file: {}", logFile, e);
            return LogReadResult.error("读取日志失败", "LOG_READ_FAILURE");
        }
    }

    /**
     * 兼容旧调用，保留原返回类型
     */
    public List<String> getLogsByLevel(String level, int lines) {
        return queryLogsByLevel(level, lines).getLogs();
    }

    /**
     * 获取日志文件资源 (用于下载)
     */
    public Resource getLogFileResource(String level) {
        String normalizedLevel = normalizeLevel(level);
        String filename = LEVEL_FILE_MAP.getOrDefault(normalizedLevel, "aetherblog.log");
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

    private static String normalizeLevel(String level) {
        if (level == null || level.isBlank()) {
            return "ALL";
        }
        String normalized = level.trim().toUpperCase(Locale.ROOT);
        return LEVEL_FILE_MAP.containsKey(normalized) ? normalized : "ALL";
    }

    private static int normalizeLines(int lines) {
        if (lines <= 0) {
            return DEFAULT_LINES;
        }
        return Math.min(lines, MAX_LINES);
    }

    /**
     * 高效读取文件最后 N 行 (使用 RandomAccessFile 从文件末尾反向读取)
     */
    private List<String> readLastLines(Path file, int lines) throws Exception {
        LinkedList<String> result = new LinkedList<>();

        try (RandomAccessFile raf = new RandomAccessFile(file.toFile(), "r")) {
            long fileLength = raf.length();
            if (fileLength == 0) {
                return Collections.emptyList();
            }

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
