package com.aetherblog.ai.client.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * AI 任务类型响应
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiTaskTypeResponse {
    private String code;
    private String name;
    private String description;
    private String model_type;
    private Double temperature;
    private Integer max_tokens;
    private String prompt_template;
}
