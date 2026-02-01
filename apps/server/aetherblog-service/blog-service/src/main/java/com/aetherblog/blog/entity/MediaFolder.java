package com.aetherblog.blog.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Data;
import lombok.ToString;
import lombok.EqualsAndHashCode;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 媒体文件夹实体
 *
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 * @author AI Assistant
 * @since 2.1.0
 */
@Data
@Entity
@Table(name = "media_folders", indexes = {
    @Index(name = "idx_media_folders_parent", columnList = "parent_id"),
    @Index(name = "idx_media_folders_path", columnList = "path"),
    @Index(name = "idx_media_folders_owner", columnList = "owner_id"),
    @Index(name = "idx_media_folders_visibility", columnList = "visibility"),
    @Index(name = "idx_media_folders_created_at", columnList = "created_at")
})
public class MediaFolder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 文件夹名称
     */
    @Column(nullable = false, length = 100)
    private String name;

    /**
     * URL友好的slug
     */
    @Column(nullable = false, length = 100)
    private String slug;

    /**
     * 文件夹描述
     */
    @Column(columnDefinition = "TEXT")
    private String description;

    /**
     * 父文件夹 (自关联)
     * @JsonIgnore 防止循环引用导致序列化错误
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    @JsonIgnore
    private MediaFolder parent;

    /**
     * 子文件夹列表
     */
    @OneToMany(mappedBy = "parent", cascade = CascadeType.ALL, orphanRemoval = true)
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private List<MediaFolder> children = new ArrayList<>();

    /**
     * 物化路径 (用于快速查询层级关系)
     * 例如: /root/design/icons
     */
    @Column(nullable = false, length = 1000, unique = true)
    private String path;

    /**
     * 文件夹深度 (根目录为0)
     */
    @Column(nullable = false)
    private Integer depth = 0;

    /**
     * 排序顺序
     */
    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder = 0;

    /**
     * 文件夹颜色 (用于UI显示)
     */
    @Column(length = 20)
    private String color = "#6366f1";

    /**
     * 文件夹图标
     */
    @Column(length = 50)
    private String icon = "Folder";

    /**
     * 封面图片
     */
    @Column(name = "cover_image", length = 500)
    private String coverImage;

    /**
     * 文件夹所有者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User owner;

    /**
     * 可见性: PRIVATE(私有), TEAM(团队), PUBLIC(公开)
     */
    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private Visibility visibility = Visibility.PRIVATE;

    /**
     * 文件数量 (缓存字段，用于快速显示)
     */
    @Column(name = "file_count", nullable = false)
    private Integer fileCount = 0;

    /**
     * 总大小 (bytes, 缓存字段)
     */
    @Column(name = "total_size", nullable = false)
    private Long totalSize = 0L;

    /**
     * 创建者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User createdBy;

    /**
     * 更新者
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "updated_by")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User updatedBy;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * 可见性枚举
     */
    public enum Visibility {
        PRIVATE,  // 私有 (仅所有者可见)
        TEAM,     // 团队 (团队成员可见)
        PUBLIC    // 公开 (所有人可见)
    }

    /**
     * 辅助方法: 添加子文件夹
     */
    public void addChild(MediaFolder child) {
        children.add(child);
        child.setParent(this);
    }

    /**
     * 辅助方法: 移除子文件夹
     */
    public void removeChild(MediaFolder child) {
        children.remove(child);
        child.setParent(null);
    }

    /**
     * 辅助方法: 判断是否为根文件夹
     */
    public boolean isRoot() {
        return parent == null && depth == 0;
    }

    /**
     * 辅助方法: 更新物化路径
     */
    public void updatePath() {
        if (parent == null) {
            this.path = "/" + slug;
        } else {
            this.path = parent.getPath() + "/" + slug;
        }
        this.depth = (parent == null) ? 0 : parent.getDepth() + 1;
    }
}
