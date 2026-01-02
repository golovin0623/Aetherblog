package com.aetherblog.ai.agent;

import com.aetherblog.ai.agent.base.AgentContext;
import com.aetherblog.ai.agent.base.AgentResult;
import com.aetherblog.ai.agent.base.BaseAgent;
import com.aetherblog.ai.core.service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * SEO 优化 Agent
 */
@Component
@RequiredArgsConstructor
public class SeoOptimizerAgent extends BaseAgent {

    private final ChatService chatService;

    private static final String SYSTEM_PROMPT = """
        你是一个专业的SEO优化专家。请对用户提供的文章进行SEO优化建议。

        请提供以下内容：
        1. 优化后的标题（含关键词，50字以内）
        2. Meta描述（含关键词，150字以内）
        3. 推荐的关键词（5-8个）
        4. 文章结构优化建议
        5. 内链建议

        请以JSON格式返回：
        {
            "title": "优化后的标题",
            "metaDescription": "Meta描述",
            "keywords": ["关键词1", "关键词2"],
            "structureSuggestions": ["建议1", "建议2"],
            "internalLinkSuggestions": ["建议1", "建议2"]
        }
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
        return "SeoOptimizer";
    }

    @Override
    public String getDescription() {
        return "SEO优化：生成SEO友好的标题、描述和关键词";
    }

    @Override
    protected String buildPrompt(AgentContext context) {
        return context.getInput();
    }
}
