package com.aetherblog.ai.agent.base;

import lombok.Data;

import java.util.HashMap;
import java.util.Map;

/**
 * Agent 上下文
 */
@Data
public class AgentContext {

    private String input;
    private Map<String, Object> parameters = new HashMap<>();
    private String modelName;
    private Double temperature;
    private Integer maxTokens;

    public AgentContext withParameter(String key, Object value) {
        this.parameters.put(key, value);
        return this;
    }

    @SuppressWarnings("unchecked")
    public <T> T getParameter(String key) {
        return (T) parameters.get(key);
    }

    @SuppressWarnings("unchecked")
    public <T> T getParameter(String key, T defaultValue) {
        Object value = parameters.get(key);
        return value != null ? (T) value : defaultValue;
    }
}
