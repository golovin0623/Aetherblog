package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;


import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * 每日统计实体
 * 
 * @ref §6.1 - 统计表 (V2 增强版)
 */
@Data
@Entity
@Table(name = "daily_stats", indexes = {
    @Index(name = "idx_daily_stats_date", columnList = "stat_date")
})
public class DailyStats {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "stat_date", nullable = false, unique = true)
    private LocalDate statDate;

    /**
     * 页面浏览量
     */
    @Column(nullable = false)
    private Long pv = 0L;

    /**
     * 独立访客数
     */
    @Column(nullable = false)
    private Long uv = 0L;

    /**
     * 新增文章数
     */
    @Column(name = "new_posts", nullable = false)
    private Integer newPosts = 0;

    /**
     * 新增评论数
     */
    @Column(name = "new_comments", nullable = false)
    private Integer newComments = 0;

    // ========== V2 新增 JSONB 统计字段 ==========

    /**
     * 文章访问量统计 (JSON格式: {postId: views})
     */
    @Column(name = "post_views", columnDefinition = "jsonb")
    private String postViews;

    /**
     * 国家/地区分布统计 (JSON格式)
     */
    @Column(name = "country_stats", columnDefinition = "jsonb")
    private String countryStats;

    /**
     * 设备类型分布统计 (JSON格式)
     */
    @Column(name = "device_stats", columnDefinition = "jsonb")
    private String deviceStats;

    /**
     * 浏览器分布统计 (JSON格式)
     */
    @Column(name = "browser_stats", columnDefinition = "jsonb")
    private String browserStats;

    /**
     * 来源分布统计 (JSON格式)
     */
    @Column(name = "referer_stats", columnDefinition = "jsonb")
    private String refererStats;

    /**
     * 平均访问时长 (秒)
     */
    @Column(name = "avg_duration")
    private Integer avgDuration = 0;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
