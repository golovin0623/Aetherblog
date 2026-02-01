package com.aetherblog.ai.client.dto.response;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 摘要生成响应
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SummaryResponse {
    
    /**
     * 生成的摘要
     */
    private String summary;
    
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

    /**
     * 字符数
     */
    private Integer characterCount;
}
