package com.aetherblog.ai.client.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 内容润色请求
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PolishRequest {
    
    /**
     * 原始内容（Markdown）
     */
    @NotBlank(message = "content cannot be blank")
    private String content;
    
    /**
     * 润色类型（grammar/clarity/style/all）
     */
    @Builder.Default
    private String polishType = "all";
    
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

    /**
     * 指定 Model ID (可选)
     */
    private String modelId;

    /**
     * 指定 Provider Code (可选)
     */
    private String providerCode;
}
