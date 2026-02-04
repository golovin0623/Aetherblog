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

import java.time.LocalDateTime;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
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

    @InjectMocks
    private StatsService statsService;

    @Test
    void testGetRecentPostStats() {
        // 准备
        when(postRepository.count()).thenReturn(100L);
        when(postRepository.countByCreatedAtGreaterThanEqual(any(LocalDateTime.class))).thenReturn(5L, 20L);

        // 执行
        Map<String, Long> stats = statsService.getRecentPostStats();

        // 断言
        assertEquals(100L, stats.get("total"));
        assertEquals(5L, stats.get("thisWeek"));
        assertEquals(20L, stats.get("thisMonth"));
    }
}
