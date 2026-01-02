package com.aetherblog.ai.core.service;

import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.stereotype.Service;

/**
 * AI 聊天服务
 */
@Service
@RequiredArgsConstructor
public class ChatService {

    private final ChatClient chatClient;

    /**
     * 简单对话
     */
    public String chat(String message) {
        return chatClient.prompt()
                .user(message)
                .call()
                .content();
    }

    /**
     * 带系统提示词的对话
     */
    public String chatWithSystem(String systemPrompt, String userMessage) {
        return chatClient.prompt()
                .system(systemPrompt)
                .user(userMessage)
                .call()
                .content();
    }

    /**
     * 获取完整响应
     */
    public ChatResponse chatWithResponse(String message) {
        return chatClient.prompt()
                .user(message)
                .call()
                .chatResponse();
    }
}
