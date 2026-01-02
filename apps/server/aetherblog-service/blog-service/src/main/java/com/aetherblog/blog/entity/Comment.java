package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 评论实体
 */
@Data
@Entity
@Table(name = "comments", indexes = {
    @Index(name = "idx_comments_post_id", columnList = "post_id"),
    @Index(name = "idx_comments_status", columnList = "status")
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
    private Comment parent;

    @Column(nullable = false, length = 50)
    private String nickname;

    @Column(length = 100)
    private String email;

    @Column(length = 200)
    private String website;

    @Column(length = 200)
    private String avatar;

    @Lob
    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private CommentStatus status = CommentStatus.PENDING;

    @Column(length = 50)
    private String ip;

    @Column(length = 200)
    private String userAgent;

    @CreationTimestamp
    private LocalDateTime createdAt;

    public enum CommentStatus {
        PENDING, APPROVED, REJECTED, SPAM
    }
}
