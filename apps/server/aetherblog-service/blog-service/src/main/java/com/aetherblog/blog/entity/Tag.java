package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 标签实体
 * 
 * @ref §6.1 - 核心表结构 (V2 增强版)
 */
@Data
@Entity
@Table(name = "tags", indexes = {
    @Index(name = "idx_tags_slug", columnList = "slug"),
    @Index(name = "idx_tags_post_count", columnList = "post_count")
})
public class Tag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 50)
    private String name;

    @Column(nullable = false, unique = true, length = 50)
    private String slug;

    /**
     * 标签描述 (V2新增)
     */
    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(length = 20)
    private String color = "#6366f1";

    /**
     * 文章数量 (缓存字段)
     */
    @Column(name = "post_count", nullable = false)
    private Integer postCount = 0;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
