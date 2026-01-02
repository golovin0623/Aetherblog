package com.aetherblog.ai.agent.base;

import lombok.Data;

/**
 * Agent 执行结果
 */
@Data
public class AgentResult {

    private boolean success;
    private String content;
    private String errorMessage;
    private long executionTime;

    public static AgentResult success(String content) {
        AgentResult result = new AgentResult();
        result.setSuccess(true);
        result.setContent(content);
        return result;
    }

    public static AgentResult failure(String errorMessage) {
        AgentResult result = new AgentResult();
        result.setSuccess(false);
        result.setErrorMessage(errorMessage);
        return result;
    }
}
