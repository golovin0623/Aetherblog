package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import lombok.ToString;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 分类实体
 * 
 * @ref §6.1 - 核心表结构 (V2 增强版)
 */
@Data
@Entity
@Table(name = "categories", indexes = {
    @Index(name = "idx_categories_slug", columnList = "slug"),
    @Index(name = "idx_categories_parent", columnList = "parent_id"),
    @Index(name = "idx_categories_sort_order", columnList = "sort_order")
})
public class Category {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, unique = true, length = 100)
    private String slug;

    @Column(columnDefinition = "TEXT")
    private String description;

    /**
     * 分类封面图 (V2新增)
     */
    @Column(name = "cover_image", length = 500)
    private String coverImage;

    /**
     * 分类图标
     */
    @Column(length = 100)
    private String icon;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private Category parent;


    @OneToMany(mappedBy = "parent", cascade = CascadeType.ALL)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private List<Category> children = new ArrayList<>();

    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

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
