package com.aetherblog.ai.client.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 标签提取请求
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TagsRequest {
    
    /**
     * 原始内容（Markdown）
     */
    @NotBlank(message = "content cannot be blank")
    private String content;
    
    /**
     * 最大标签数
     */
    @Positive(message = "maxTags must be positive")
    @Builder.Default
    private Integer maxTags = 5;
    
    /**
     * 模型
     */
    private String model;
    
    /**
     * Prompt 版本
     */
    private String promptVersion;

    /**
     * 指定 Model ID (可选)
     */
    private String modelId;

    /**
     * 指定 Provider Code (可选)
     */
    private String providerCode;
}
