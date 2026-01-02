package com.aetherblog.ai.agent.base;

/**
 * Agent 基类
 */
public abstract class BaseAgent {

    /**
     * 执行 Agent 任务
     */
    public abstract AgentResult execute(AgentContext context);

    /**
     * 获取 Agent 名称
     */
    public abstract String getName();

    /**
     * 获取 Agent 描述
     */
    public abstract String getDescription();

    /**
     * 构建提示词
     */
    protected abstract String buildPrompt(AgentContext context);
}
