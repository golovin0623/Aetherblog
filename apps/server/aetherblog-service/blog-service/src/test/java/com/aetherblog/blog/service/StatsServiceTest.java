package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.AiUsageLog;
import com.aetherblog.blog.repository.AiUsageLogRepository;
import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.CommentRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import com.aetherblog.blog.repository.VisitRecordRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class StatsServiceTest {

    @Mock
    private PostRepository postRepository;
    @Mock
    private CategoryRepository categoryRepository;
    @Mock
    private TagRepository tagRepository;
    @Mock
    private CommentRepository commentRepository;
    @Mock
    private VisitRecordRepository visitRecordRepository;
    @Mock
    private AiUsageLogRepository aiUsageLogRepository;
    @Mock
    private Clock clock;

    @InjectMocks
    private StatsService statsService;

    @Test
    void testGetRecentPostStats() {
        LocalDateTime fixedTime = LocalDateTime.of(2024, 1, 15, 10, 0);
        when(clock.instant()).thenReturn(fixedTime.toInstant(ZoneOffset.UTC));
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);

        LocalDateTime thisWeekStart = fixedTime.with(DayOfWeek.MONDAY).truncatedTo(ChronoUnit.DAYS);
        LocalDateTime thisMonthStart = fixedTime.withDayOfMonth(1).truncatedTo(ChronoUnit.DAYS);

        when(postRepository.count()).thenReturn(100L);
        when(postRepository.countByCreatedAtGreaterThanEqual(eq(thisWeekStart))).thenReturn(5L);
        when(postRepository.countByCreatedAtGreaterThanEqual(eq(thisMonthStart))).thenReturn(20L);

        Map<String, Long> stats = statsService.getRecentPostStats();

        assertEquals(100L, stats.get("total"));
        assertEquals(5L, stats.get("thisWeek"));
        assertEquals(20L, stats.get("thisMonth"));
    }

    @Test
    void testGetDashboardStatsIncludesAiMetrics() {
        when(postRepository.count()).thenReturn(10L);
        when(categoryRepository.count()).thenReturn(3L);
        when(tagRepository.count()).thenReturn(9L);
        when(commentRepository.count()).thenReturn(4L);
        when(visitRecordRepository.count()).thenReturn(120L);
        when(visitRecordRepository.countDistinctVisitorByCreatedAtAfter(any(LocalDateTime.class))).thenReturn(80L);
        when(postRepository.findAll()).thenReturn(List.of());
        when(aiUsageLogRepository.sumTotalTokensByCreatedAtAfter(any(LocalDateTime.class))).thenReturn(3210L);
        when(aiUsageLogRepository.sumEstimatedCostByCreatedAtAfter(any(LocalDateTime.class))).thenReturn(new BigDecimal("1.2345"));

        StatsService.DashboardStats stats = statsService.getDashboardStats();

        assertEquals(10L, stats.posts());
        assertEquals(3210L, stats.aiTokens());
        assertEquals(1.2345, stats.aiCost(), 0.000001);
    }

    @Test
    void testGetAiAnalyticsDashboardAggregatesOverview() {
        LocalDateTime fixedTime = LocalDateTime.of(2024, 1, 15, 10, 0);
        when(clock.instant()).thenReturn(fixedTime.toInstant(ZoneOffset.UTC));
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);

        when(aiUsageLogRepository.aggregateOverview(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(new Object[]{20L, 18L, 2L, 5000L, new BigDecimal("2.50000000"), 140.0, 6L});
        when(aiUsageLogRepository.aggregateDailyTrend(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of(
                        new Object[]{LocalDate.of(2024, 1, 14), 5L, 1000L, new BigDecimal("0.40000000")},
                        new Object[]{LocalDate.of(2024, 1, 15), 7L, 2000L, new BigDecimal("1.20000000")}
                ));
        when(aiUsageLogRepository.aggregateModelDistribution(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of(
                        new Object[]{"gpt-4o-mini", "openai", 12L, 3300L, new BigDecimal("1.65000000")},
                        new Object[]{"deepseek-chat", "deepseek", 8L, 1700L, new BigDecimal("0.85000000")}
                ));
        when(aiUsageLogRepository.aggregateTaskDistribution(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of(
                        new Object[]{"summary", 10L, 2500L, new BigDecimal("1.00000000")},
                        new Object[]{"translate", 10L, 2500L, new BigDecimal("1.50000000")}
                ));

        AiUsageLog log = new AiUsageLog();
        log.setId(1L);
        log.setTaskType("summary");
        log.setProviderCode("openai");
        log.setModelId("gpt-4o-mini");
        log.setTokensIn(100);
        log.setTokensOut(120);
        log.setTotalTokens(220);
        log.setEstimatedCost(new BigDecimal("0.01000000"));
        log.setLatencyMs(120);
        log.setSuccess(true);
        log.setCached(false);
        log.setCreatedAt(LocalDateTime.of(2024, 1, 15, 9, 30));

        when(aiUsageLogRepository.findRecords(any(LocalDateTime.class), any(LocalDateTime.class), any(), any(), eq(null), eq(null), any(PageRequest.class)))
                .thenReturn(new PageImpl<>(List.of(log), PageRequest.of(0, 20), 1));

        StatsService.AiAnalyticsDashboard dashboard = statsService.getAiAnalyticsDashboard(7, 1, 20, null, null, null, null);

        assertEquals(7, dashboard.rangeDays());
        assertEquals(20L, dashboard.overview().totalCalls());
        assertEquals(90, dashboard.overview().successRate());
        assertEquals(30, dashboard.overview().cacheHitRate());
        assertEquals(7, dashboard.trend().size());
        assertFalse(dashboard.modelDistribution().isEmpty());
        assertFalse(dashboard.records().list().isEmpty());
    }

    @Test
    void testGetAiAnalyticsDashboardNormalizesBoundsAndFallbackTotalTokens() {
        LocalDateTime fixedTime = LocalDateTime.of(2024, 1, 15, 10, 0);
        when(clock.instant()).thenReturn(fixedTime.toInstant(ZoneOffset.UTC));
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);

        when(aiUsageLogRepository.aggregateOverview(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(new Object[]{1L, 1L, 0L, 0L, BigDecimal.ZERO, 90.0, 0L});
        when(aiUsageLogRepository.aggregateDailyTrend(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of());
        when(aiUsageLogRepository.aggregateModelDistribution(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of());
        when(aiUsageLogRepository.aggregateTaskDistribution(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of());

        AiUsageLog log = new AiUsageLog();
        log.setId(2L);
        log.setTaskType("summary");
        log.setProviderCode("openai");
        log.setModelId("gpt-5-mini");
        log.setTokensIn(40);
        log.setTokensOut(20);
        log.setTotalTokens(0);
        log.setEstimatedCost(BigDecimal.ZERO);
        log.setLatencyMs(80);
        log.setSuccess(true);
        log.setCached(false);
        log.setCreatedAt(LocalDateTime.of(2024, 1, 15, 8, 0));

        when(aiUsageLogRepository.findRecords(any(LocalDateTime.class), any(LocalDateTime.class), any(), any(), eq(null), eq(null), any(PageRequest.class)))
                .thenReturn(new PageImpl<>(List.of(log), PageRequest.of(0, 100), 1));

        StatsService.AiAnalyticsDashboard dashboard = statsService.getAiAnalyticsDashboard(0, 0, 1000, null, null, null, null);

        assertEquals(7, dashboard.rangeDays());
        assertEquals(1, dashboard.records().pageNum());
        assertEquals(100, dashboard.records().pageSize());
        assertEquals(60, dashboard.records().list().get(0).totalTokens());

        ArgumentCaptor<PageRequest> pageRequestCaptor = ArgumentCaptor.forClass(PageRequest.class);
        verify(aiUsageLogRepository).findRecords(any(LocalDateTime.class), any(LocalDateTime.class), any(), any(), eq(null), eq(null), pageRequestCaptor.capture());
        assertEquals(0, pageRequestCaptor.getValue().getPageNumber());
        assertEquals(100, pageRequestCaptor.getValue().getPageSize());
    }

    @Test
    void testGetAiAnalyticsDashboardSupportsNestedOverviewRow() {
        LocalDateTime fixedTime = LocalDateTime.of(2024, 1, 15, 10, 0);
        when(clock.instant()).thenReturn(fixedTime.toInstant(ZoneOffset.UTC));
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);

        when(aiUsageLogRepository.aggregateOverview(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(new Object[]{
                        new Object[]{20L, 18L, 2L, 5000L, new BigDecimal("2.50000000"), 140.0, 6L}
                });
        when(aiUsageLogRepository.aggregateDailyTrend(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of());
        when(aiUsageLogRepository.aggregateModelDistribution(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of());
        when(aiUsageLogRepository.aggregateTaskDistribution(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(List.of());
        when(aiUsageLogRepository.findRecords(any(LocalDateTime.class), any(LocalDateTime.class), any(), any(), eq(null), eq(null), any(PageRequest.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));

        StatsService.AiAnalyticsDashboard dashboard = statsService.getAiAnalyticsDashboard(7, 1, 20, null, null, null, null);

        assertEquals(20L, dashboard.overview().totalCalls());
        assertEquals(18L, dashboard.overview().successCalls());
        assertEquals(2L, dashboard.overview().errorCalls());
        assertEquals(5000L, dashboard.overview().totalTokens());
        assertEquals(2.5, dashboard.overview().totalCost(), 0.000001);
        assertEquals(140.0, dashboard.overview().avgLatencyMs(), 0.000001);
    }

}
