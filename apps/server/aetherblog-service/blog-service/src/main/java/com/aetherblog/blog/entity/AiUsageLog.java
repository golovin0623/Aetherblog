package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * AI 调用记录实体
 */
@Data
@Entity
@Table(name = "ai_usage_logs", indexes = {
        @Index(name = "idx_ai_usage_logs_created_at", columnList = "created_at"),
        @Index(name = "idx_ai_usage_logs_task_created", columnList = "task_type, created_at"),
        @Index(name = "idx_ai_usage_logs_model_created", columnList = "model_id, created_at"),
        @Index(name = "idx_ai_usage_logs_provider_created", columnList = "provider_code, created_at")
})
public class AiUsageLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", length = 64, nullable = false)
    private String userId;

    @Column(name = "endpoint", length = 128, nullable = false)
    private String endpoint;

    @Column(name = "task_type", length = 64)
    private String taskType;

    @Column(name = "provider_code", length = 64)
    private String providerCode;

    @Column(name = "model_id", length = 128)
    private String modelId;

    @Column(name = "model", length = 128, nullable = false)
    private String model;

    @Column(name = "request_chars", nullable = false)
    private Integer requestChars = 0;

    @Column(name = "response_chars", nullable = false)
    private Integer responseChars = 0;

    @Column(name = "tokens_in", nullable = false)
    private Integer tokensIn = 0;

    @Column(name = "tokens_out", nullable = false)
    private Integer tokensOut = 0;

    @Column(name = "total_tokens", nullable = false)
    private Integer totalTokens = 0;

    @Column(name = "latency_ms", nullable = false)
    private Integer latencyMs = 0;

    @Column(name = "estimated_cost", precision = 16, scale = 8, nullable = false)
    private BigDecimal estimatedCost = BigDecimal.ZERO;

    @Column(name = "success", nullable = false)
    private Boolean success = true;

    @Column(name = "cached", nullable = false)
    private Boolean cached = false;

    @Column(name = "error_code", length = 128)
    private String errorCode;

    @Column(name = "request_id", length = 64)
    private String requestId;

    @CreationTimestamp
    @Column(name = "created_at")
    private LocalDateTime createdAt;
}
