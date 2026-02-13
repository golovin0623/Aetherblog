package com.aetherblog.blog.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LogViewerServiceTest {

    @TempDir
    Path tempDir;

    private LogViewerService logViewerService;

    @BeforeEach
    void setUp() {
        logViewerService = new LogViewerService();
        ReflectionTestUtils.setField(logViewerService, "logPath", tempDir.toString());
    }

    @Test
    void queryLogsByLevelReturnsOkForExistingFile() throws Exception {
        Path errorLog = tempDir.resolve("error.log");
        Files.writeString(errorLog, String.join("\n", List.of("line-1", "line-2", "line-3")));

        LogViewerService.LogReadResult result = logViewerService.queryLogsByLevel("ERROR", 2);

        assertEquals("OK", result.getStatus());
        assertEquals(2, result.getLogs().size());
        assertEquals("line-2", result.getLogs().get(0));
        assertEquals("line-3", result.getLogs().get(1));
    }

    @Test
    void queryLogsByLevelReturnsNoDataWhenFileMissing() {
        LogViewerService.LogReadResult result = logViewerService.queryLogsByLevel("INFO", 2000);

        assertTrue(result.isNoData());
        assertEquals("LOG_FILE_NOT_FOUND", result.getErrorCategory());
        assertTrue(result.getLogs().isEmpty());
    }

    @Test
    void queryLogsByLevelReturnsErrorWhenFileUnreadable() throws Exception {
        Files.createDirectory(tempDir.resolve("warn.log"));

        LogViewerService.LogReadResult result = logViewerService.queryLogsByLevel("WARN", 100);

        assertTrue(result.isError());
        assertEquals("LOG_READ_FAILURE", result.getErrorCategory());
        assertTrue(result.getLogs().isEmpty());
    }
}
