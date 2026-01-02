package com.aetherblog.ai.agent;

import com.aetherblog.ai.agent.base.AgentContext;
import com.aetherblog.ai.agent.base.AgentResult;
import com.aetherblog.ai.agent.base.BaseAgent;
import com.aetherblog.ai.core.service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 自动标签生成 Agent
 */
@Component
@RequiredArgsConstructor
public class AutoTaggerAgent extends BaseAgent {

    private final ChatService chatService;

    private static final String SYSTEM_PROMPT = """
        你是一个专业的文章标签生成助手。请根据用户提供的文章内容生成合适的标签。
        
        要求：
        1. 生成3-5个标签
        2. 标签应准确反映文章的主题和关键概念
        3. 每个标签应简洁（2-4个字）
        4. 标签之间用逗号分隔
        
        只返回标签列表，格式：标签1,标签2,标签3
        """;

    @Override
    public AgentResult execute(AgentContext context) {
        long startTime = System.currentTimeMillis();
        try {
            String result = chatService.chatWithSystem(SYSTEM_PROMPT, context.getInput());
            AgentResult agentResult = AgentResult.success(result);
            agentResult.setExecutionTime(System.currentTimeMillis() - startTime);
            return agentResult;
        } catch (Exception e) {
            return AgentResult.failure(e.getMessage());
        }
    }

    @Override
    public String getName() {
        return "AutoTagger";
    }

    @Override
    public String getDescription() {
        return "自动标签：从文章内容生成3-5个标签";
    }

    @Override
    protected String buildPrompt(AgentContext context) {
        return context.getInput();
    }
}
