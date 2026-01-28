package com.aetherblog.ai.client.client;

import com.aetherblog.ai.client.config.AiServiceProperties;
import com.aetherblog.ai.client.dto.request.*;
import com.aetherblog.ai.client.dto.response.*;
import com.aetherblog.ai.client.dto.stream.StreamEvent;
import com.aetherblog.ai.client.dto.stream.StreamError;
import com.aetherblog.ai.client.exception.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;

/**
 * AI 服务 HTTP 客户端实现
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiServiceHttpClient implements AiServiceClient {
    
    private final WebClient aiWebClient;
    private final AiServiceProperties properties;
    private final StreamParser streamParser;
    
    @Override
    public Mono<AiResponse<SummaryResponse>> generateSummary(SummaryRequest request) {
        return performRequest(
            "/api/v1/ai/summary",
            request,
            new ParameterizedTypeReference<AiResponse<SummaryResponse>>() {}
        );
    }
    
    @Override
    public Flux<StreamEvent> generateSummaryStream(SummaryRequest request) {
        return aiWebClient.post()
            .uri("/api/v1/ai/summary/stream")
            .contentType(MediaType.APPLICATION_JSON)
            .accept(MediaType.parseMediaType("application/x-ndjson"))
            .bodyValue(request)
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToFlux(String.class)
            .flatMap(streamParser::parse)
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Stream error: {}", error.getMessage()))
            .onErrorResume(this::handleStreamError);
    }
    
    @Override
    public Mono<AiResponse<TagsResponse>> extractTags(TagsRequest request) {
        return performRequest(
            "/api/v1/ai/tags",
            request,
            new ParameterizedTypeReference<AiResponse<TagsResponse>>() {}
        );
    }
    
    @Override
    public Mono<AiResponse<TitlesResponse>> suggestTitles(TitlesRequest request) {
        return performRequest(
            "/api/v1/ai/titles",
            request,
            new ParameterizedTypeReference<AiResponse<TitlesResponse>>() {}
        );
    }
    
    @Override
    public Mono<AiResponse<PolishResponse>> polishContent(PolishRequest request) {
        return performRequest(
            "/api/v1/ai/polish",
            request,
            new ParameterizedTypeReference<AiResponse<PolishResponse>>() {}
        );
    }
    
    @Override
    public Mono<AiResponse<OutlineResponse>> generateOutline(OutlineRequest request) {
        return performRequest(
            "/api/v1/ai/outline",
            request,
            new ParameterizedTypeReference<AiResponse<OutlineResponse>>() {}
        );
    }

    
    /**
     * 执行通用请求
     */
    private <T, R> Mono<AiResponse<R>> performRequest(
        String uri,
        T request,
        ParameterizedTypeReference<AiResponse<R>> responseType
    ) {
        return aiWebClient.post()
            .uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(request)
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(responseType)
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("AI request failed: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }
    
    /**
     * 处理错误响应
     */
    private Mono<Throwable> handleErrorResponse(ClientResponse response) {
        return response.bodyToMono(String.class)
            .flatMap(body -> {
                HttpStatus status = (HttpStatus) response.statusCode();
                if (status == HttpStatus.TOO_MANY_REQUESTS) {
                    return Mono.error(new AiRateLimitException("AI service rate limit exceeded"));
                } else if (status == HttpStatus.REQUEST_TIMEOUT || status == HttpStatus.GATEWAY_TIMEOUT) {
                    return Mono.error(new AiTimeoutException("AI service timeout"));
                } else {
                    return Mono.error(new AiServiceException("AI service error: " + body));
                }
            });
    }
    
    /**
     * 流式错误处理
     */
    private Flux<StreamEvent> handleStreamError(Throwable error) {
        if (error instanceof AiServiceException) {
            return Flux.just(StreamError.of(error.getMessage()));
        }
        return Flux.just(StreamError.of("Stream processing failed"));
    }
    
    /**
     * 非流式错误处理
     */
    private <R> Mono<AiResponse<R>> handleNonStreamError(Throwable error) {
        log.error("Non-stream request failed", error);
        return Mono.just(AiResponse.error(
            "AI_SERVICE_ERROR",
            error.getMessage()
        ));
    }
}
