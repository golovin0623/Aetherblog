package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.CommentRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;


import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 数据统计服务
 * 
 * @ref §8.2 - Dashboard 统计功能
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StatsService {

    private final PostRepository postRepository;
    private final CategoryRepository categoryRepository;
    private final TagRepository tagRepository;
    private final CommentRepository commentRepository;

    /**
     * 获取 Dashboard 概览统计
     */
    public DashboardStats getDashboardStats() {
        long postCount = postRepository.count();
        long categoryCount = categoryRepository.count();
        long tagCount = tagRepository.count();
        long commentCount = commentRepository.count();
        
        // 计算总浏览量
        Long totalViews = postRepository.findAll().stream()
                .mapToLong(Post::getViewCount)
                .sum();

        return new DashboardStats(
                postCount,
                categoryCount,
                tagCount,
                commentCount,
                totalViews,
                0L  // 访客数需要 visit_records 表，暂为 0
        );
    }

    /**
     * 获取热门文章排行
     */
    public List<TopPost> getTopPosts(int limit) {
        return postRepository.findHotPosts(PageRequest.of(0, limit))
                .getContent()
                .stream()
                .map(post -> new TopPost(
                        post.getId(),
                        post.getTitle(),
                        post.getSlug(),
                        post.getViewCount()
                ))
                .toList();
    }

    /**
     * 获取月度归档统计
     */
    public List<ArchiveStats> getMonthlyArchiveStats() {
        var posts = postRepository.findAllByStatusOrderByPublishedAtDesc(Post.PostStatus.PUBLISHED);
        
        // 按年月分组统计
        Map<String, Long> monthlyCount = posts.stream()
                .filter(p -> p.getPublishedAt() != null)
                .collect(Collectors.groupingBy(
                        p -> p.getPublishedAt().format(DateTimeFormatter.ofPattern("yyyy-MM")),
                        Collectors.counting()
                ));
        
        // 转换为列表并排序（最新月份在前）
        return monthlyCount.entrySet().stream()
                .map(e -> new ArchiveStats(e.getKey(), e.getValue().intValue()))
                .sorted((a, b) -> b.month().compareTo(a.month()))
                .toList();
    }

    /**
     * 获取访客趋势数据 (暂未实现，返回空)
     */
    public List<VisitorTrend> getVisitorTrend(int days) {
        // TODO: 需要 visit_records 表实现
        return Collections.emptyList();
    }

    /**
     * 获取近期文章统计
     */
    public Map<String, Long> getRecentPostStats() {
        long totalPosts = postRepository.count();
        // TODO: 实现按时间过滤的文章统计
        // 需要在 PostRepository 中添加按创建时间查询的方法
        
        Map<String, Long> stats = new HashMap<>();
        stats.put("total", totalPosts);
        stats.put("thisWeek", 0L);  // 需要按创建时间过滤
        stats.put("thisMonth", 0L); // 需要按创建时间过滤
        
        return stats;
    }

    // DTO Records
    public record DashboardStats(
            long posts,
            long categories,
            long tags,
            long comments,
            long views,
            long visitors
    ) {}

    public record TopPost(
            Long id,
            String title,
            String slug,
            Long views
    ) {}

    public record ArchiveStats(
            String month,
            int count
    ) {}

    public record VisitorTrend(
            String date,
            long pv,
            long uv
    ) {}
}
