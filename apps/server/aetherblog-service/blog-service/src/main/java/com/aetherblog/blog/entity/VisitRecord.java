package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 访问记录实体
 * 
 * @ref §3.2-6 - 统计分析模块
 */
@Data
@Entity
@Table(name = "visit_records", indexes = {
    @Index(name = "idx_visit_records_post", columnList = "post_id"),
    @Index(name = "idx_visit_records_visitor", columnList = "visitor_hash"),
    @Index(name = "idx_visit_records_bot_created", columnList = "is_bot, created_at")
})
public class VisitRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 关联文章
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id")
    private Post post;

    /**
     * 页面URL
     */
    @Column(name = "page_url", length = 500)
    private String pageUrl;

    /**
     * 页面标题
     */
    @Column(name = "page_title", length = 200)
    private String pageTitle;

    /**
     * 访客哈希 (fingerprint hash)
     */
    @Column(name = "visitor_hash", length = 64, nullable = false)
    private String visitorHash;

    /**
     * IP 地址
     */
    @Column(length = 50)
    private String ip;

    /**
     * 国家
     */
    @Column(length = 50)
    private String country;

    /**
     * 省/州
     */
    @Column(length = 50)
    private String region;

    /**
     * 城市
     */
    @Column(length = 50)
    private String city;

    /**
     * User Agent
     */
    @Column(name = "user_agent", length = 500)
    private String userAgent;

    /**
     * 设备类型
     */
    @Column(name = "device_type", length = 20)
    @Enumerated(EnumType.STRING)
    private DeviceType deviceType;

    /**
     * 浏览器
     */
    @Column(length = 50)
    private String browser;

    /**
     * 操作系统
     */
    @Column(length = 50)
    private String os;

    /**
     * 来源页面
     */
    @Column(length = 500)
    private String referer;

    /**
     * 会话ID
     */
    @Column(name = "session_id", length = 100)
    private String sessionId;

    /**
     * 访问时长 (秒)
     */
    @Column(name = "duration")
    private Integer duration = 0;

    /**
     * 是否为爬虫/机器人访问
     */
    @Column(name = "is_bot")
    private Boolean isBot = false;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public enum DeviceType {
        DESKTOP, MOBILE, TABLET, OTHER
    }
}
