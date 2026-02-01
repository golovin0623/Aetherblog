package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 媒体标签实体
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 * @author AI Assistant
 * @since 2.2.0
 */
@Data
@Entity
@Table(name = "media_tags", indexes = {
    @Index(name = "idx_media_tags_slug", columnList = "slug"),
    @Index(name = "idx_media_tags_usage", columnList = "usage_count"),
    @Index(name = "idx_media_tags_category", columnList = "category")
})
public class MediaTag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 标签名称
     */
    @Column(nullable = false, unique = true, length = 50)
    private String name;

    /**
     * URL友好的slug
     */
    @Column(nullable = false, unique = true, length = 50)
    private String slug;

    /**
     * 标签描述
     */
    @Column(columnDefinition = "TEXT")
    private String description;

    /**
     * 标签颜色
     */
    @Column(length = 20)
    private String color = "#6366f1";

    /**
     * 标签分类: CUSTOM(自定义), AI_DETECTED(AI识别), SYSTEM(系统)
     */
    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private TagCategory category = TagCategory.CUSTOM;

    /**
     * 使用次数 (缓存字段)
     */
    @Column(name = "usage_count", nullable = false)
    private Integer usageCount = 0;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * 标签分类枚举
     */
    public enum TagCategory {
        CUSTOM,      // 用户自定义
        AI_DETECTED, // AI自动识别
        SYSTEM       // 系统预设
    }
}
