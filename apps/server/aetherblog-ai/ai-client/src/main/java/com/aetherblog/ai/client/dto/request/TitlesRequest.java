package com.aetherblog.ai.client.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 标题建议请求
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TitlesRequest {
    
    /**
     * 文章内容（Markdown）
     */
    @NotBlank(message = "content cannot be blank")
    private String content;
    
    /**
     * 生成标题数量
     */
    @Positive(message = "count must be positive")
    @Builder.Default
    private Integer count = 5;
    
    /**
     * 风格（professional/creative/seo）
     */
    @Builder.Default
    private String style = "professional";
    
    /**
     * 模型
     */
    private String model;
    
    /**
     * Prompt 版本
     */
    private String promptVersion;
}
