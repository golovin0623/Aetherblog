package com.aetherblog.ai.core.service;

import lombok.RequiredArgsConstructor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

/**
 * 流式输出服务
 */
@Service
@RequiredArgsConstructor
@SuppressWarnings("null")
public class StreamingService {

    private final ChatClient chatClient;

    /**
     * 流式对话
     */
    public Flux<String> streamChat(String message) {
        return chatClient.prompt()
                .user(message)
                .stream()
                .content();
    }

    /**
     * 流式对话（带系统提示词）
     */
    public Flux<String> streamChatWithSystem(String systemPrompt, String userMessage) {
        return chatClient.prompt()
                .system(systemPrompt)
                .user(userMessage)
                .stream()
                .content();
    }
}
