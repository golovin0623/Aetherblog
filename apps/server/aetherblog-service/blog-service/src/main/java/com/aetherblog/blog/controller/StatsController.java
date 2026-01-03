package com.aetherblog.blog.controller;

import com.aetherblog.blog.service.StatsService;
import com.aetherblog.blog.service.StatsService.*;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 统计数据控制器
 * 
 * @ref §8.2 - Dashboard 统计接口
 */
@Tag(name = "统计数据", description = "后台统计数据接口")
@RestController
@RequestMapping("/v1/admin/stats")
@RequiredArgsConstructor
public class StatsController {

    private final StatsService statsService;

    @Operation(summary = "获取 Dashboard 完整统计")
    @GetMapping("/dashboard")
    public R<Map<String, Object>> getDashboardData() {
        Map<String, Object> data = new HashMap<>();
        
        // 基础统计
        DashboardStats stats = statsService.getDashboardStats();
        data.put("stats", stats);
        
        // 热门文章
        List<TopPost> topPosts = statsService.getTopPosts(5);
        data.put("topPosts", topPosts);
        
        // 访客趋势 (暂为空)
        List<VisitorTrend> visitorTrend = statsService.getVisitorTrend(7);
        data.put("visitorTrend", visitorTrend);
        
        // 归档统计
        List<ArchiveStats> archiveStats = statsService.getMonthlyArchiveStats();
        data.put("archiveStats", archiveStats);
        
        return R.ok(data);
    }

    @Operation(summary = "获取热门文章排行")
    @GetMapping("/top-posts")
    public R<List<TopPost>> getTopPosts(
            @RequestParam(defaultValue = "10") int limit) {
        return R.ok(statsService.getTopPosts(limit));
    }

    @Operation(summary = "获取访客趋势")
    @GetMapping("/visitor-trend")
    public R<List<VisitorTrend>> getVisitorTrend(
            @RequestParam(defaultValue = "7") int days) {
        return R.ok(statsService.getVisitorTrend(days));
    }

    @Operation(summary = "获取归档统计")
    @GetMapping("/archives")
    public R<List<ArchiveStats>> getArchiveStats() {
        return R.ok(statsService.getMonthlyArchiveStats());
    }
}
