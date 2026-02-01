package com.aetherblog.ai.client.dto.request;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Prompt 配置更新请求
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PromptUpdateRequest {
    
    /**
     * Prompt 模板内容 (为 null 则表示移除自定义 Prompt 使用系统默认)
     */
    @JsonProperty("prompt_template")
    private String promptTemplate;
}
