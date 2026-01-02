package com.aetherblog.ai.agent;

import com.aetherblog.ai.agent.base.AgentContext;
import com.aetherblog.ai.agent.base.AgentResult;
import com.aetherblog.ai.agent.base.BaseAgent;
import com.aetherblog.ai.core.service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 摘要生成 Agent
 */
@Component
@RequiredArgsConstructor
public class ContentSummarizerAgent extends BaseAgent {

    private final ChatService chatService;

    private static final String SYSTEM_PROMPT = """
        你是一个专业的内容摘要生成助手。请根据用户提供的文章内容生成一段简洁的摘要。
        
        要求：
        1. 摘要长度控制在100-200字
        2. 准确概括文章的核心内容和主要观点
        3. 语言流畅、通顺
        4. 不要添加原文没有的信息
        
        只返回摘要文本，不要添加任何前缀或解释。
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
        return "ContentSummarizer";
    }

    @Override
    public String getDescription() {
        return "内容摘要：生成100-200字的文章摘要";
    }

    @Override
    protected String buildPrompt(AgentContext context) {
        return context.getInput();
    }
}
