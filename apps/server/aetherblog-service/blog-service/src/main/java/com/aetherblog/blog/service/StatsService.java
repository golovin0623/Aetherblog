package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.CommentRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import com.aetherblog.blog.repository.VisitRecordRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
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
    private final VisitRecordRepository visitRecordRepository;

    /**
     * 获取 Dashboard 概览统计
     */
    public DashboardStats getDashboardStats() {
        long postCount = postRepository.count();
        long categoryCount = categoryRepository.count();
        long tagCount = tagRepository.count();
        long commentCount = commentRepository.count();

        // 计算总浏览量（从 visit_records 表）
        long totalViews = visitRecordRepository.count();

        // 计算独立访客数（从 visit_records 表，去重 visitor_hash）
        long totalVisitors = visitRecordRepository.countDistinctVisitorByCreatedAtAfter(
            LocalDateTime.of(2020, 1, 1, 0, 0)
        );

        // 计算总字数
        Long totalWords = postRepository.findAll().stream()
                .filter(post -> post.getWordCount() != null)
                .mapToLong(Post::getWordCount)
                .sum();

        // TODO: AI tokens 和费用需要从 AI 使用记录表中统计
        long aiTokens = 0L;
        double aiCost = 0.0;

        return new DashboardStats(
                postCount,
                categoryCount,
                tagCount,
                commentCount,
                totalViews,
                totalVisitors,
                totalWords,
                aiTokens,
                aiCost
        );
    }


    /**
     * 获取带趋势计算的 Dashboard 统计
     */
    public DashboardStatsWithTrends getDashboardStatsWithTrends() {
        DashboardStats stats = getDashboardStats();
        
        // 计算趋势：比较本月与上月
        var now = java.time.LocalDateTime.now();
        var thisMonthStart = now.withDayOfMonth(1).withHour(0).withMinute(0).withSecond(0);
        var lastMonthStart = thisMonthStart.minusMonths(1);
        
        // 文章趋势（本月新增 vs 上月新增）
        int postsThisMonth = postRepository.countByCreatedAtBetween(thisMonthStart, now);
        int postsLastMonth = postRepository.countByCreatedAtBetween(lastMonthStart, thisMonthStart);
        int postsTrend = calculateTrend(postsThisMonth, postsLastMonth);
        
        // 分类趋势 - 有数据但无历史对比时为 100%
        int categoryTrend = stats.categories() > 0 ? 100 : 0;
        
        // 浏览量/访客趋势 - 有数据但无历史对比时为 100%
        int viewsTrend = stats.views() > 0 ? 100 : 0;
        int visitorsTrend = stats.visitors() > 0 ? 100 : 0;
        
        // 评论趋势 - 有数据但无历史对比时为 100%
        int commentsTrend = stats.comments() > 0 ? 100 : 0;
        
        // 字数趋势 - 有数据但无历史对比时为 100%
        int wordsTrend = stats.totalWords() > 0 ? 100 : 0;
        
        return new DashboardStatsWithTrends(
                stats,
                postsTrend,
                categoryTrend,
                viewsTrend,
                visitorsTrend,
                commentsTrend,
                wordsTrend,
                postsThisMonth
        );
    }

    private int calculateTrend(int current, int previous) {
        if (previous == 0) return current > 0 ? 100 : 0;
        return (int) Math.round(((double) (current - previous) / previous) * 100);
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
     * 获取访客趋势数据 (基于 visit_records 表)
     *
     * @param days 查询最近多少天的数据 (最大 30 天)
     * @return 每日 PV/UV 列表，排除机器人访问，聚合每日数据
     */
    public List<VisitorTrend> getVisitorTrend(int days) {
        // 默认查询最近7天，最大支持30天
        if (days <= 0) days = 7;
        if (days > 30) days = 30;

        LocalDateTime startTime = LocalDate.now().minusDays(days - 1).atStartOfDay();
        
        // 从 visit_records 表获取每日统计 (已在 Repository 层过滤 isBot = false)
        List<Object[]> dailyStats = visitRecordRepository.getDailyStats(startTime);
        
        // 构建日期到数据的映射
        Map<String, VisitorTrend> trendMap = new HashMap<>();
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");
        
        if (dailyStats != null) {
            for (Object[] row : dailyStats) {
                if (row == null || row.length < 3) continue;

                LocalDate date;
                Object dateObj = row[0];
                if (dateObj instanceof LocalDate ld) {
                    date = ld;
                } else if (dateObj instanceof java.sql.Date sd) {
                    date = sd.toLocalDate();
                } else if (dateObj instanceof java.util.Date ud) {
                    date = ud.toInstant().atZone(java.time.ZoneId.systemDefault()).toLocalDate();
                } else {
                    log.warn("getDailyStats 返回了未知的日期类型: {}", dateObj != null ? dateObj.getClass() : "null");
                    continue;
                }

                String dateStr = date.format(formatter);
                long pv = row[1] != null ? ((Number) row[1]).longValue() : 0L;
                long uv = row[2] != null ? ((Number) row[2]).longValue() : 0L;

                trendMap.put(dateStr, new VisitorTrend(dateStr, pv, uv));
            }
        }
        
        // 补全缺失的日期，确保返回连续的时间序列
        List<VisitorTrend> result = new ArrayList<>();
        LocalDate today = LocalDate.now();
        for (int i = days - 1; i >= 0; i--) {
            String dateStr = today.minusDays(i).format(formatter);
            result.add(trendMap.getOrDefault(dateStr, new VisitorTrend(dateStr, 0, 0)));
        }
        
        return result;
    }

    /**
     * 获取近期文章统计
     */
    public Map<String, Long> getRecentPostStats() {
        LocalDateTime now = LocalDateTime.now();
        // 本周开始时间 (周一 00:00:00)
        LocalDateTime thisWeekStart = now.with(java.time.DayOfWeek.MONDAY).truncatedTo(java.time.temporal.ChronoUnit.DAYS);
        // 本月开始时间 (1号 00:00:00)
        LocalDateTime thisMonthStart = now.withDayOfMonth(1).truncatedTo(java.time.temporal.ChronoUnit.DAYS);

        long totalPosts = postRepository.count();
        long thisWeekPosts = postRepository.countByCreatedAtGreaterThanEqual(thisWeekStart);
        long thisMonthPosts = postRepository.countByCreatedAtGreaterThanEqual(thisMonthStart);
        
        Map<String, Long> stats = new HashMap<>();
        stats.put("total", totalPosts);
        stats.put("thisWeek", thisWeekPosts);
        stats.put("thisMonth", thisMonthPosts);
        
        return stats;
    }

    /**
     * 获取设备分布统计
     */
    public List<DeviceStats> getDeviceStats() {
        List<Object[]> results = visitRecordRepository.countByDeviceType();
        long total = results.stream().mapToLong(row -> ((Number) row[1]).longValue()).sum();
        
        if (total == 0) {
            return Collections.emptyList();
        }

        return results.stream()
                .map(row -> {
                    com.aetherblog.blog.entity.VisitRecord.DeviceType type = (com.aetherblog.blog.entity.VisitRecord.DeviceType) row[0];
                    long count = ((Number) row[1]).longValue();
                    String name = switch (type) {
                        case DESKTOP -> "桌面端";
                        case MOBILE -> "移动端";
                        case TABLET -> "平板";
                        default -> "其他";
                    };
                    // 计算百分比 (保留1位小数)
                    // double percentage = Math.round((double) count / total * 1000) / 10.0;
                    // 直接返回数量，前端计算百分比更好
                    return new DeviceStats(name, count);
                })
                .sorted((a, b) -> Long.compare(b.value(), a.value()))
                .toList();
    }

    // DTO 记录
    public record DashboardStats(
            long posts,
            long categories,
            long tags,
            long comments,
            long views,
            long visitors,
            long totalWords,      // 总字数
            long aiTokens,        // AI总tokens数量
            double aiCost         // AI总费用（美元）
    ) {}

    public record TopPost(
            Long id,
            String title,
            String slug,
            Long viewCount
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
    
    public record DeviceStats(
            String name,
            long value
    ) {}

    public record DashboardStatsWithTrends(
            DashboardStats stats,
            int postsTrend,         // 文章增长趋势百分比
            int categoriesTrend,    // 分类增长趋势
            int viewsTrend,         // 浏览量增长趋势
            int visitorsTrend,      // 访客增长趋势
            int commentsTrend,      // 评论增长趋势
            int wordsTrend,         // 字数增长趋势
            int postsThisMonth      // 本月新增文章数
    ) {}
}
