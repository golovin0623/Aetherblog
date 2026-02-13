package com.aetherblog.blog.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
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

    @Test
    void queryLogsSupportsKeywordLimitAndCursor() throws Exception {
        Path allLog = tempDir.resolve("aetherblog.log");
        Files.writeString(allLog, String.join("\n", List.of(
                "INFO startup",
                "ERROR db timeout",
                "WARN cache miss",
                "ERROR http 500",
                "ERROR payment failed"
        )));

        LogViewerService.LogReadResult firstPage = logViewerService.queryLogs("ALL", 2000, 2, "error", null);

        assertEquals("OK", firstPage.getStatus());
        assertEquals(List.of("ERROR db timeout", "ERROR http 500"), firstPage.getLogs());
        assertEquals("0", firstPage.getCursor());
        assertEquals("2", firstPage.getNextCursor());

        LogViewerService.LogReadResult secondPage = logViewerService.queryLogs("ALL", 2000, 2, "error", firstPage.getNextCursor());
        assertEquals("OK", secondPage.getStatus());
        assertEquals(List.of("ERROR payment failed"), secondPage.getLogs());
        assertEquals("2", secondPage.getCursor());
        assertNull(secondPage.getNextCursor());
    }

    @Test
    void queryLogsReturnsNoDataForExhaustedCursor() throws Exception {
        Path allLog = tempDir.resolve("aetherblog.log");
        Files.writeString(allLog, String.join("\n", List.of("line-1", "line-2")));

        LogViewerService.LogReadResult result = logViewerService.queryLogs("ALL", 2000, 1, null, "9");

        assertTrue(result.isNoData());
        assertEquals("LOG_CURSOR_EXHAUSTED", result.getErrorCategory());
        assertNotNull(result.getMessage());
    }
}
