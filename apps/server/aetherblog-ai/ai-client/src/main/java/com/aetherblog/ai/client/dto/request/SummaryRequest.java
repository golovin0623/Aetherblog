package com.aetherblog.ai.client.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 摘要生成请求
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SummaryRequest {
    
    /**
     * 原始内容（Markdown）
     */
    @NotBlank(message = "content cannot be blank")
    private String content;
    
    /**
     * 摘要最大长度（字符数）
     */
    @Positive(message = "maxLength must be positive")
    @Builder.Default
    private Integer maxLength = 200;
    
    /**
     * 风格（professional/casual/technical）
     */
    @Builder.Default
    private String style = "professional";
    
    /**
     * 模型（gpt-4o-mini/gpt-4o）
     */
    private String model;
    
    /**
     * Prompt 版本
     */
    private String promptVersion;
}
