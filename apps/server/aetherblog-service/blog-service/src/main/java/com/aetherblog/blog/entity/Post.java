package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

/**
 * 文章实体
 * 
 * @ref §4.2 - 核心表结构 (V2 增强版)
 */
@Data
@Entity
@Table(name = "posts", indexes = {
    @Index(name = "idx_posts_slug", columnList = "slug"),
    @Index(name = "idx_posts_status", columnList = "status"),
    @Index(name = "idx_posts_published_at", columnList = "published_at"),
    @Index(name = "idx_posts_category", columnList = "category_id"),
    @Index(name = "idx_posts_author", columnList = "author_id"),
    @Index(name = "idx_posts_deleted", columnList = "deleted"),
    @Index(name = "idx_posts_embedding_status", columnList = "embedding_status")
})
public class Post {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false, unique = true, length = 200)
    private String slug;

    /**
     * Markdown 原始内容
     */
    @Column(name = "content_markdown", columnDefinition = "TEXT")
    private String contentMarkdown;

    /**
     * 渲染后的 HTML 内容缓存
     */
    @Column(name = "content_html", columnDefinition = "TEXT")
    private String contentHtml;

    @Column(length = 500)
    private String summary;

    @Column(name = "cover_image", length = 500)
    private String coverImage;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private PostStatus status = PostStatus.DRAFT;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "category_id")
    private Category category;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "author_id")
    private User author;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(
        name = "post_tags",
        joinColumns = @JoinColumn(name = "post_id"),
        inverseJoinColumns = @JoinColumn(name = "tag_id")
    )
    private Set<Tag> tags = new HashSet<>();

    @Column(name = "view_count", nullable = false)
    private Long viewCount = 0L;

    @Column(name = "comment_count", nullable = false)
    private Long commentCount = 0L;

    @Column(name = "like_count", nullable = false)
    private Long likeCount = 0L;

    /**
     * 文章字数
     */
    @Column(name = "word_count")
    private Integer wordCount = 0;

    /**
     * 预计阅读时间 (分钟)
     */
    @Column(name = "reading_time")
    private Integer readingTime = 0;

    /**
     * 是否置顶
     */
    @Column(name = "is_pinned", nullable = false)
    private Boolean isPinned = false;

    /**
     * 置顶优先级 (数值越大优先级越高，0表示不置顶)
     */
    @Column(name = "pin_priority", nullable = false)
    private Integer pinPriority = 0;

    /**
     * 是否精选
     */
    @Column(name = "is_featured", nullable = false)
    private Boolean isFeatured = false;

    /**
     * 是否允许评论
     */
    @Column(name = "allow_comment", nullable = false)
    private Boolean allowComment = true;

    /**
     * 文章密码 (加密访问)
     */
    @Column(length = 100)
    private String password;

    // ========== V2 新增字段 ==========

    /**
     * SEO 标题
     */
    @Column(name = "seo_title", length = 200)
    private String seoTitle;

    /**
     * SEO 描述
     */
    @Column(name = "seo_description", length = 300)
    private String seoDescription;

    /**
     * SEO 关键词
     */
    @Column(name = "seo_keywords", length = 200)
    private String seoKeywords;

    /**
     * 向量化状态
     */
    @Column(name = "embedding_status", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private EmbeddingStatus embeddingStatus = EmbeddingStatus.PENDING;

    /**
     * 软删除标记
     */
    @Column(nullable = false)
    private Boolean deleted = false;

    /**
     * 定时发布时间
     */
    @Column(name = "scheduled_at")
    private LocalDateTime scheduledAt;

    @Column(name = "published_at")
    private LocalDateTime publishedAt;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public enum PostStatus {
        DRAFT, PUBLISHED, ARCHIVED, SCHEDULED
    }

    public enum EmbeddingStatus {
        PENDING, INDEXED, FAILED
    }
}
