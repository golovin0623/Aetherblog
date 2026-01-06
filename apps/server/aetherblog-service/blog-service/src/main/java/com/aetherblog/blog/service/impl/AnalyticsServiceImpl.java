package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.DailyStats;
import com.aetherblog.blog.entity.VisitRecord;
import com.aetherblog.blog.repository.DailyStatsRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.VisitRecordRepository;
import com.aetherblog.blog.service.AnalyticsService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * 访问分析服务实现
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §3.2-6 - 统计分析模块
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AnalyticsServiceImpl implements AnalyticsService {

    private final VisitRecordRepository visitRecordRepository;
    private final DailyStatsRepository dailyStatsRepository;
    private final PostRepository postRepository;

    @Override
    @Async
    @Transactional
    public void recordVisit(VisitRecord record) {
        Objects.requireNonNull(record, "访问记录不能为空");
        visitRecordRepository.save(record);
        log.debug("记录访问: url={}, ip={}", record.getPageUrl(), record.getIp());
    }

    @Override
    public Map<String, Long> getTodayStats() {
        LocalDateTime todayStart = LocalDate.now().atStartOfDay();
        Map<String, Long> stats = new HashMap<>();
        Long pv = visitRecordRepository.countByCreatedAtAfter(todayStart);
        Long uv = visitRecordRepository.countDistinctVisitorByCreatedAtAfter(todayStart);
        stats.put("pv", pv != null ? pv : 0L);
        stats.put("uv", uv != null ? uv : 0L);
        return stats;
    }

    @Override
    public List<DailyStats> getRecentTrend(int days) {
        LocalDate endDate = LocalDate.now();
        LocalDate startDate = endDate.minusDays(days - 1);
        return dailyStatsRepository.findByStatDateBetweenOrderByStatDateAsc(startDate, endDate);
    }

    @Override
    public Map<String, Long> getTrafficSources(int limit) {
        // 简化实现：按 referer 域名分组
        // 实际需要解析 referer URL 提取域名
        return new HashMap<>();
    }

    @Override
    public Map<String, Long> getDeviceDistribution() {
        List<Object[]> results = visitRecordRepository.countByDeviceType();
        if (results == null || results.isEmpty()) {
            return new HashMap<>();
        }
        return results.stream()
                .filter(r -> r != null && r.length >= 2 && r[0] != null)
                .collect(Collectors.toMap(
                        r -> r[0].toString(),
                        r -> r[1] != null ? (Long) r[1] : 0L,
                        (v1, v2) -> v1 // 处理重复key
                ));
    }

    @Override
    public Map<String, Long> getBrowserDistribution(int limit) {
        List<Object[]> results = visitRecordRepository.countByBrowser(PageRequest.of(0, limit));
        if (results == null || results.isEmpty()) {
            return new HashMap<>();
        }
        return results.stream()
                .filter(r -> r != null && r.length >= 2 && r[0] != null)
                .collect(Collectors.toMap(
                        r -> (String) r[0],
                        r -> r[1] != null ? (Long) r[1] : 0L,
                        (v1, v2) -> v1
                ));
    }

    @Override
    public Map<String, Long> getGeoDistribution(int limit) {
        List<Object[]> results = visitRecordRepository.countByCountry(PageRequest.of(0, limit));
        if (results == null || results.isEmpty()) {
            return new HashMap<>();
        }
        return results.stream()
                .filter(r -> r != null && r.length >= 2 && r[0] != null)
                .collect(Collectors.toMap(
                        r -> (String) r[0],
                        r -> r[1] != null ? (Long) r[1] : 0L,
                        (v1, v2) -> v1
                ));
    }

    @Override
    public List<Map<String, Object>> getTopPosts(int limit) {
        List<Object[]> results = visitRecordRepository.findTopVisitedPosts(PageRequest.of(0, limit));
        if (results == null) {
            return List.of();
        }
        return results.stream()
                .filter(r -> r != null && r.length >= 2)
                .map(r -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("postId", r[0]);
                    map.put("views", r[1] != null ? r[1] : 0L);
                    return map;
                })
                .collect(Collectors.toList());
    }

    @Override
    @Transactional
    public void aggregateDailyStats(LocalDate date) {
        Objects.requireNonNull(date, "日期不能为空");
        LocalDateTime startOfDay = date.atStartOfDay();
        LocalDateTime endOfDay = date.atTime(LocalTime.MAX);

        Long pvCount = visitRecordRepository.countByCreatedAtAfter(startOfDay);
        Long uvCount = visitRecordRepository.countDistinctVisitorByCreatedAtAfter(startOfDay);
        long pv = pvCount != null ? pvCount : 0L;
        long uv = uvCount != null ? uvCount : 0L;

        // 统计新增文章数
        int newPosts = postRepository.countByCreatedAtBetween(startOfDay, endOfDay);
        
        // 新增评论数暂设为0，后续可扩展
        int newComments = 0;

        DailyStats stats = dailyStatsRepository.findByStatDate(date)
                .orElseGet(DailyStats::new);
        
        stats.setStatDate(date);
        stats.setPv(pv);
        stats.setUv(uv);
        stats.setNewPosts(newPosts);
        stats.setNewComments(newComments);

        dailyStatsRepository.save(stats);
        log.info("聚合每日统计: date={}, pv={}, uv={}", date, pv, uv);
    }
}
