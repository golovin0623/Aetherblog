package com.aetherblog.ai.client.config;

import io.netty.channel.ChannelOption;
import io.netty.handler.timeout.ReadTimeoutHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * AI 服务 WebClient 配置
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Configuration
@RequiredArgsConstructor
public class AiWebClientConfig {
    
    private final AiServiceProperties properties;
    
    @Bean
    public WebClient aiWebClient(WebClient.Builder builder) {
        HttpClient httpClient = HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, properties.getConnectTimeout())
            .responseTimeout(Duration.ofMillis(properties.getReadTimeout()))
            .doOnConnected(conn -> 
                conn.addHandlerLast(new ReadTimeoutHandler(
                    properties.getReadTimeout(), 
                    TimeUnit.MILLISECONDS
                ))
            );
        
        return builder
            .baseUrl(properties.getBaseUrl())
            .clientConnector(new ReactorClientHttpConnector(httpClient))
            .defaultHeader("Content-Type", "application/json")
            .defaultHeader("Accept", "application/json, application/x-ndjson")
            .build();
    }
}
