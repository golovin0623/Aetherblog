package com.aetherblog.ai.client.dto.response;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 内容润色响应
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PolishResponse {
    
    /**
     * 润色后的内容
     */
    private String polishedContent;
    
    /**
     * 修改说明（可选）
     */
    private String changes;
    
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
