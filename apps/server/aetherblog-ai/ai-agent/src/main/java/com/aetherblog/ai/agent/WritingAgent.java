package com.aetherblog.ai.agent;

import com.aetherblog.ai.agent.base.AgentContext;
import com.aetherblog.ai.agent.base.AgentResult;
import com.aetherblog.ai.agent.base.BaseAgent;
import com.aetherblog.ai.core.service.ChatService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 写作 Agent - 续写/扩写
 */
@Component
@RequiredArgsConstructor
public class WritingAgent extends BaseAgent {

    private final ChatService chatService;

    private static final String CONTINUE_PROMPT = """
        你是一个专业的写作助手。请根据用户提供的内容进行续写。

        要求：
        1. 保持原文的风格和语调
        2. 内容连贯自然
        3. 续写长度约200-300字
        4. 不要重复原文内容

        原文：
        %s

        请续写：
        """;

    private static final String EXPAND_PROMPT = """
        你是一个专业的写作助手。请对用户提供的内容进行扩写，添加更多细节和论述。

        要求：
        1. 保持原文的核心观点
        2. 增加论据、例子或细节描述
        3. 扩写后的内容应是原文的1.5-2倍
        4. 保持文章结构清晰

        原文：
        %s

        请扩写：
        """;

    @Override
    public AgentResult execute(AgentContext context) {
        long startTime = System.currentTimeMillis();
        try {
            String mode = context.getParameter("mode", "continue");
            String prompt = mode.equals("expand") 
                    ? String.format(EXPAND_PROMPT, context.getInput())
                    : String.format(CONTINUE_PROMPT, context.getInput());
            
            String result = chatService.chat(prompt);
            AgentResult agentResult = AgentResult.success(result);
            agentResult.setExecutionTime(System.currentTimeMillis() - startTime);
            return agentResult;
        } catch (Exception e) {
            return AgentResult.failure(e.getMessage());
        }
    }

    @Override
    public String getName() {
        return "WritingAgent";
    }

    @Override
    public String getDescription() {
        return "写作助手：续写和扩写内容";
    }

    @Override
    protected String buildPrompt(AgentContext context) {
        return context.getInput();
    }
}
