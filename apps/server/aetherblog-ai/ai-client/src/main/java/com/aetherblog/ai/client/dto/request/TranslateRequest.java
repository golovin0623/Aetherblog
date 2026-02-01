package com.aetherblog.ai.client.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 翻译请求
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TranslateRequest {
    
    /**
     * 需要翻译的内容
     */
    @NotBlank(message = "content cannot be blank")
    private String content;
    
    /**
     * 目标语言 (en, zh, ja, ko, etc.)
     */
    @Builder.Default
    private String targetLanguage = "en";
    
    /**
     * 源语言 (null 表示自动检测)
     */
    private String sourceLanguage;
    
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
