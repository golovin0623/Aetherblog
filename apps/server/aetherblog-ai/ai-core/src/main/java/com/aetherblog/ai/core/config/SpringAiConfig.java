package com.aetherblog.ai.core.config;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Spring AI 配置类
 * 
 * 手动配置 OpenAI 相关 Bean，绕过 Spring AI 自动配置与 Spring Boot 4.0 的兼容性问题
 */
@Configuration
@ConditionalOnProperty(name = "spring.ai.openai.api-key")
public class SpringAiConfig {

    @Value("${spring.ai.openai.api-key:}")
    private String apiKey;

    @Value("${spring.ai.openai.base-url:https://api.openai.com}")
    private String baseUrl;

    @Value("${spring.ai.openai.chat.model:gpt-5.2}")
    private String model;

    @Value("${spring.ai.openai.chat.options.temperature:0.7}")
    private Double temperature;

    @Bean
    public OpenAiApi openAiApi() {
        return OpenAiApi.builder()
            .apiKey(apiKey)
            .baseUrl(baseUrl)
            .build();
    }

    @Bean
    public OpenAiChatModel openAiChatModel(OpenAiApi openAiApi) {
        OpenAiChatOptions options = OpenAiChatOptions.builder()
            .model(model)
            .temperature(temperature)
            .build();
        return OpenAiChatModel.builder()
            .openAiApi(openAiApi)
            .defaultOptions(options)
            .build();
    }

    @Value("${spring.ai.openai.embedding.model:text-embedding-3-small}")
    private String embeddingModelName;

    @Bean
    public org.springframework.ai.embedding.EmbeddingModel embeddingModel(OpenAiApi openAiApi) {
        org.springframework.ai.openai.OpenAiEmbeddingOptions options = org.springframework.ai.openai.OpenAiEmbeddingOptions.builder()
            .model(embeddingModelName)
            .build();
        
        return new org.springframework.ai.openai.OpenAiEmbeddingModel(
            openAiApi, 
            org.springframework.ai.document.MetadataMode.EMBED, 
            options
        );
    }

    @Bean
    public ChatClient chatClient(OpenAiChatModel chatModel) {
        return ChatClient.builder(chatModel).build();
    }
}
