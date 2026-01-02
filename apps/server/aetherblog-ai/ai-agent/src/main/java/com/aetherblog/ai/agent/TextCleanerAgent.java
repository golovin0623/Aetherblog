package com.aetherblog.ai.agent;

import com.aetherblog.ai.agent.base.AgentContext;
import com.aetherblog.ai.agent.base.AgentResult;
import com.aetherblog.ai.agent.base.BaseAgent;
import com.aetherblog.ai.core.service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 文本清洗 Agent
 */
@Component
@RequiredArgsConstructor
public class TextCleanerAgent extends BaseAgent {

    private final ChatService chatService;

    private static final String SYSTEM_PROMPT = """
        你是一个专业的文本清洗助手。请对用户提供的文本进行以下处理：
        1. 修正明显的错别字和语法错误
        2. 移除多余的空格和换行
        3. 统一标点符号（使用中文标点）
        4. 保持原文的结构和语义不变
        
        只返回清洗后的文本，不要添加任何解释。
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
        return "TextCleaner";
    }

    @Override
    public String getDescription() {
        return "文本清洗：修正错别字、统一格式";
    }

    @Override
    protected String buildPrompt(AgentContext context) {
        return context.getInput();
    }
}
