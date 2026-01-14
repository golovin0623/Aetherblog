package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.util.Map;

/**
 * 日统计汇总实体
 * 
 * @description 用于存储每日访问统计数据，支持趋势图展示
 */
@Entity
@Table(name = "visit_daily_stats", indexes = {
    @Index(name = "idx_visit_daily_stats_date", columnList = "statDate")
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class VisitDailyStat {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 统计日期
     */
    @Column(name = "stat_date", nullable = false, unique = true)
    private LocalDate statDate;

    /**
     * 页面浏览量 (Page Views)
     */
    @Column
    @Builder.Default
    private Integer pv = 0;

    /**
     * 独立访客数 (Unique Visitors)
     */
    @Column
    @Builder.Default
    private Integer uv = 0;

    /**
     * 新访客数
     */
    @Column(name = "new_visitors")
    @Builder.Default
    private Integer newVisitors = 0;

    /**
     * 爬虫访问数
     */
    @Column(name = "bot_visits")
    @Builder.Default
    private Integer botVisits = 0;

    /**
     * 国家/地区分布统计 (JSON 格式)
     * 示例: {"CN": 100, "US": 50, "JP": 30}
     */
    @Column(name = "country_stats", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Integer> countryStats;
}
