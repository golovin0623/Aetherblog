package com.aetherblog.blog.service;

import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.CommentRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import com.aetherblog.blog.repository.VisitRecordRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.eq;
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
}
