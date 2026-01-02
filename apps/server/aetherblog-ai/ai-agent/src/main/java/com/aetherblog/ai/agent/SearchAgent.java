package com.aetherblog.ai.agent;

import com.aetherblog.ai.agent.base.AgentContext;
import com.aetherblog.ai.agent.base.AgentResult;
import com.aetherblog.ai.agent.base.BaseAgent;
import com.aetherblog.ai.rag.service.RagService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 语义搜索 Agent
 */
@Component
@RequiredArgsConstructor
public class SearchAgent extends BaseAgent {

    private final RagService ragService;

    @Override
    public AgentResult execute(AgentContext context) {
        long startTime = System.currentTimeMillis();
        try {
            int topK = context.getParameter("topK", 5);
            double threshold = context.getParameter("threshold", 0.7);
            
            String result = ragService.query(context.getInput(), topK, threshold);
            AgentResult agentResult = AgentResult.success(result);
            agentResult.setExecutionTime(System.currentTimeMillis() - startTime);
            return agentResult;
        } catch (Exception e) {
            return AgentResult.failure(e.getMessage());
        }
    }

    @Override
    public String getName() {
        return "SearchAgent";
    }

    @Override
    public String getDescription() {
        return "语义搜索：基于 RAG 的智能问答";
    }

    @Override
    protected String buildPrompt(AgentContext context) {
        return context.getInput();
    }
}
