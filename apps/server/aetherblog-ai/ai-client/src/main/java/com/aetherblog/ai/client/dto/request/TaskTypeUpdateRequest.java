package com.aetherblog.ai.client.dto.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 更新 AI 任务类型请求
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TaskTypeUpdateRequest {
    private String name;
    private String description;
    private String model_type;
    private Double temperature;
    private Integer max_tokens;
    private String prompt_template;
}
