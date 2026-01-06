package com.aetherblog.ai.prompt.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * Prompt 模板实体
 * 
 * @ref §6.1 - Prompt 模板表 (V2 增强版)
 */
@Data
@Entity
@Table(name = "prompt_templates", indexes = {
    @Index(name = "idx_prompt_templates_category", columnList = "category"),
    @Index(name = "idx_prompt_templates_active", columnList = "active")
})
public class PromptTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 100)
    private String name;

    @Column(length = 500)
    private String description;

    @Lob
    @Column(nullable = false, columnDefinition = "TEXT")
    private String template;

    @Column(nullable = false, length = 50)
    @Enumerated(EnumType.STRING)
    private PromptCategory category;

    @Column(nullable = false)
    private Boolean active = true;

    // ========== V2 新增字段 ==========

    /**
     * 是否为系统内置模板
     */
    @Column(name = "is_system", nullable = false)
    private Boolean isSystem = false;

    /**
     * 使用次数统计
     */
    @Column(name = "usage_count", nullable = false)
    private Integer usageCount = 0;

    /**
     * 创建者ID
     */
    @Column(name = "created_by")
    private Long createdBy;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public enum PromptCategory {
        TEXT_CLEANING,
        REWRITING,
        SUMMARIZATION,
        TAGGING,
        SEO,
        QA,
        CUSTOM
    }
}
