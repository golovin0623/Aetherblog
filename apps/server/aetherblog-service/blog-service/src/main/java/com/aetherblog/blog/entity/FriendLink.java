package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 友链实体
 * 
 * @ref §6.1 - 核心表结构 (V2 增强版)
 */
@Data
@Entity
@Table(name = "friend_links", indexes = {
    @Index(name = "idx_friend_links_visible", columnList = "visible"),
    @Index(name = "idx_friend_links_sort", columnList = "sort_order")
})
public class FriendLink {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 500)
    private String url;

    /**
     * 友链Logo/头像
     */
    @Column(length = 500)
    private String logo;

    @Column(length = 500)
    private String description;

    // ========== V2 新增字段 ==========

    /**
     * 联系邮箱
     */
    @Column(length = 100)
    private String email;

    /**
     * RSS 订阅地址
     */
    @Column(name = "rss_url", length = 500)
    private String rssUrl;

    /**
     * 主题颜色
     */
    @Column(name = "theme_color", length = 20)
    private String themeColor = "#6366f1";

    /**
     * 是否在线 (定期检测)
     */
    @Column(name = "is_online")
    private Boolean isOnline = true;

    /**
     * 最后检测时间
     */
    @Column(name = "last_check_at")
    private LocalDateTime lastCheckAt;

    // ========== 原有字段 ==========

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    @Column(nullable = false)
    private Boolean visible = true;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
