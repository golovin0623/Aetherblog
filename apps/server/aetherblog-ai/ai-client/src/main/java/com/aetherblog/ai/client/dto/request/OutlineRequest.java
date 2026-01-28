package com.aetherblog.ai.client.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 大纲生成请求
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OutlineRequest {
    
    /**
     * 主题或简要描述
     */
    @NotBlank(message = "topic cannot be blank")
    private String topic;
    
    /**
     * 现有内容（可选，用于扩展大纲）
     */
    private String existingContent;
    
    /**
     * 大纲层级深度（1-3）
     */
    @Builder.Default
    private Integer depth = 2;
    
    /**
     * 风格（professional/casual/technical）
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
