package com.aetherblog.ai.client.dto.response;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 大纲生成响应
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class OutlineResponse {
    
    /**
     * 生成的大纲（Markdown 格式）
     */
    private String outline;
    
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
