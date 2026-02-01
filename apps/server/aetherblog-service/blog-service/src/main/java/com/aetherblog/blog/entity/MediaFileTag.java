package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import org.hibernate.annotations.CreationTimestamp;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 媒体文件-标签关联实体
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 * @author AI Assistant
 * @since 2.2.0
 */
@Data
@Entity
@Table(name = "media_file_tags", indexes = {
    @Index(name = "idx_media_file_tags_file", columnList = "media_file_id"),
    @Index(name = "idx_media_file_tags_tag", columnList = "tag_id"),
    @Index(name = "idx_media_file_tags_source", columnList = "source")
})
public class MediaFileTag {

    @EmbeddedId
    private MediaFileTagId id;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("mediaFileId")
    @JoinColumn(name = "media_file_id")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private MediaFile mediaFile;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("tagId")
    @JoinColumn(name = "tag_id")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private MediaTag tag;

    @CreationTimestamp
    @Column(name = "tagged_at")
    private LocalDateTime taggedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tagged_by")
    @ToString.Exclude
    @EqualsAndHashCode.Exclude
    private User taggedBy;

    /**
     * 标签来源: MANUAL(手动), AI_AUTO(AI自动), AI_SUGGESTED(AI建议)
     */
    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private TagSource source = TagSource.MANUAL;

    /**
     * 标签来源枚举
     */
    public enum TagSource {
        MANUAL,       // 手动添加
        AI_AUTO,      // AI自动添加
        AI_SUGGESTED  // AI建议(待确认)
    }

    /**
     * 复合主键
     */
    @Data
    @Embeddable
    public static class MediaFileTagId implements Serializable {
        @Column(name = "media_file_id")
        private Long mediaFileId;

        @Column(name = "tag_id")
        private Long tagId;
    }
}
