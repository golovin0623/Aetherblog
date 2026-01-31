package com.aetherblog.ai.client.dto.response;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Prompt 配置响应
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PromptConfigResponse {
    
    /**
     * 任务类型 (如 summary, tags)
     */
    @JsonProperty("task_type")
    private String taskType;
    
    /**
     * 系统默认 Prompt
     */
    @JsonProperty("default_prompt")
    private String defaultPrompt;
    
    /**
     * 用户自定义 Prompt
     */
    @JsonProperty("custom_prompt")
    private String customPrompt;
}
