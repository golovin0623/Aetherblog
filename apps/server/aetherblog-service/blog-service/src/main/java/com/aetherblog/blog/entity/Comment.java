package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import lombok.ToString;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 评论实体
 * 
 * @ref §6.1 - 核心表结构 (V2 增强版)
 */
@Data
@Entity
@Table(name = "comments", indexes = {
    @Index(name = "idx_comments_post", columnList = "post_id"),
    @Index(name = "idx_comments_parent", columnList = "parent_id"),
    @Index(name = "idx_comments_status", columnList = "status"),
    @Index(name = "idx_comments_created", columnList = "createdAt")
})
public class Comment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "post_id", nullable = false)
    private Post post;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private Comment parent;

    @Column(nullable = false, length = 50)
    private String nickname;

    @Column(length = 100)
    private String email;

    @Column(length = 200)
    private String website;

    @Column(length = 200)
    private String avatar;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private CommentStatus status = CommentStatus.PENDING;

    @Column(length = 50)
    private String ip;

    @Column(name = "user_agent", length = 500)
    private String userAgent;

    /**
     * 是否为管理员回复
     */
    @Column(name = "is_admin", nullable = false)
    private Boolean isAdmin = false;

    /**
     * 评论点赞数 (V2新增)
     */
    @Column(name = "like_count", nullable = false)
    private Integer likeCount = 0;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public enum CommentStatus {
        PENDING, APPROVED, REJECTED, SPAM, DELETED
    }
}
