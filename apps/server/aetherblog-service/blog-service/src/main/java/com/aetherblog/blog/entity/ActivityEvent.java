package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 活动事件实体
 * 
 * @ref §8.2 - 仪表盘最近动态
 */
@Data
@Entity
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Table(name = "activity_events", indexes = {
    @Index(name = "idx_activity_events_type", columnList = "event_type"),
    @Index(name = "idx_activity_events_category", columnList = "event_category"),
    @Index(name = "idx_activity_events_created", columnList = "created_at"),
    @Index(name = "idx_activity_events_user", columnList = "user_id"),
    @Index(name = "idx_activity_events_status", columnList = "status")
})
public class ActivityEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 事件类型代码
     * 如: POST_PUBLISH, COMMENT_NEW, USER_LOGIN
     */
    @Column(name = "event_type", nullable = false, length = 50)
    private String eventType;

    /**
     * 事件分类
     */
    @Column(name = "event_category", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private EventCategory eventCategory;

    /**
     * 事件标题 (展示用)
     */
    @Column(nullable = false, length = 200)
    private String title;

    /**
     * 事件描述/详情
     */
    @Column(columnDefinition = "TEXT")
    private String description;

    /**
     * 扩展元数据 (JSON格式)
     * 可存储 postId, commentId, fileName 等关联信息
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * 触发用户 (可为空，系统事件无用户)
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    /**
     * IP 地址
     */
    @Column(length = 50)
    private String ip;

    /**
     * 事件状态
     */
    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    @Builder.Default
    private EventStatus status = EventStatus.INFO;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    /**
     * 事件分类枚举
     */
    public enum EventCategory {
        POST,       // 文章事件
        COMMENT,    // 评论事件
        USER,       // 用户事件
        SYSTEM,     // 系统事件
        FRIEND,     // 友链事件
        MEDIA,      // 媒体事件
        AI          // AI 事件
    }

    /**
     * 事件状态枚举
     */
    public enum EventStatus {
        INFO,       // 信息
        SUCCESS,    // 成功
        WARNING,    // 警告
        ERROR       // 错误
    }
}
