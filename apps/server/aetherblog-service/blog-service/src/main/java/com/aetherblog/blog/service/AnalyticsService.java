package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.DailyStats;
import com.aetherblog.blog.entity.VisitRecord;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 访问分析服务接口
 * 
 * @ref §3.2-6 - 统计分析模块
 */
public interface AnalyticsService {

    /**
     * 记录访问
     */
    void recordVisit(VisitRecord record);

    /**
     * 获取今日统计
     */
    Map<String, Long> getTodayStats();

    /**
     * 获取近N天统计趋势
     */
    List<DailyStats> getRecentTrend(int days);

    /**
     * 获取访问来源分布
     */
    Map<String, Long> getTrafficSources(int limit);

    /**
     * 获取设备分布
     */
    Map<String, Long> getDeviceDistribution();

    /**
     * 获取浏览器分布
     */
    Map<String, Long> getBrowserDistribution(int limit);

    /**
     * 获取地区分布
     */
    Map<String, Long> getGeoDistribution(int limit);

    /**
     * 获取热门文章
     */
    List<Map<String, Object>> getTopPosts(int limit);

    /**
     * 聚合每日统计 (定时任务调用)
     */
    void aggregateDailyStats(LocalDate date);
}
