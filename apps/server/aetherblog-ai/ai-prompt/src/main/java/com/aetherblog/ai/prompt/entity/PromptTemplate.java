package com.aetherblog.ai.prompt.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * Prompt 模板实体
 */
@Data
@Entity
@Table(name = "prompt_templates")
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

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
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
