package com.aetherblog.ai.client.dto.response;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 翻译响应
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TranslateResponse {
    
    /**
     * 翻译后的内容
     */
    private String translatedContent;
    
    /**
     * 检测到的源语言
     */
    private String sourceLanguage;
    
    /**
     * 目标语言
     */
    private String targetLanguage;
    
    /**
     * 使用的模型
     */
    private String model;
    
    /**
     * 使用的 Token 数
     */
    private Integer tokensUsed;
    
    /**
     * 生成耗时（毫秒）
     */
    private Long latencyMs;
}
