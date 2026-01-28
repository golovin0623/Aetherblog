package com.aetherblog.ai.client.dto.response;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 标签提取响应
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TagsResponse {
    
    /**
     * 提取的标签列表
     */
    private List<String> tags;
    
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
