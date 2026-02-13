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
    public Mono<AiResponse<SummaryResponse>> generateSummary(SummaryRequest request, String token) {
        return performRequest(
            "/api/v1/ai/summary",
            request,
            token,
            new ParameterizedTypeReference<AiResponse<SummaryResponse>>() {}
        );
    }
    
    @Override
    public Flux<StreamEvent> generateSummaryStream(SummaryRequest request, String token) {
        return aiWebClient.post()
            .uri("/api/v1/ai/summary/stream")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", requireAuthorizationToken(token))
            .accept(MediaType.TEXT_EVENT_STREAM)
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
    public Mono<AiResponse<TagsResponse>> extractTags(TagsRequest request, String token) {
        return performRequest(
            "/api/v1/ai/tags",
            request,
            token,
            new ParameterizedTypeReference<AiResponse<TagsResponse>>() {}
        );
    }
    
    @Override
    public Mono<AiResponse<TitlesResponse>> suggestTitles(TitlesRequest request, String token) {
        return performRequest(
            "/api/v1/ai/titles",
            request,
            token,
            new ParameterizedTypeReference<AiResponse<TitlesResponse>>() {}
        );
    }
    
    @Override
    public Mono<AiResponse<PolishResponse>> polishContent(PolishRequest request, String token) {
        return performRequest(
            "/api/v1/ai/polish",
            request,
            token,
            new ParameterizedTypeReference<AiResponse<PolishResponse>>() {}
        );
    }
    
    @Override
    public Mono<AiResponse<OutlineResponse>> generateOutline(OutlineRequest request, String token) {
        return performRequest(
            "/api/v1/ai/outline",
            request,
            token,
            new ParameterizedTypeReference<AiResponse<OutlineResponse>>() {}
        );
    }

    @Override
    public Mono<AiResponse<PromptConfigResponse>> getPromptConfig(String taskType, String token) {
        return aiWebClient.get()
            .uri("/api/v1/admin/ai/prompts/{taskType}", taskType)
            .header("Authorization", requireAuthorizationToken(token))
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(new ParameterizedTypeReference<AiResponse<PromptConfigResponse>>() {})
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Failed to get prompt config: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }

    @Override
    public Mono<AiResponse<java.util.List<PromptConfigResponse>>> listPromptConfigs(String token) {
        return aiWebClient.get()
            .uri("/api/v1/admin/ai/prompts")
            .header("Authorization", requireAuthorizationToken(token))
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(new ParameterizedTypeReference<AiResponse<java.util.List<PromptConfigResponse>>>() {})
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Failed to list prompt configs: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }

    @Override
    public Mono<AiResponse<Boolean>> updatePromptConfig(String taskType, PromptUpdateRequest request, String token) {
        return aiWebClient.put()
            .uri("/api/v1/admin/ai/prompts/{taskType}", taskType)
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", requireAuthorizationToken(token))
            .bodyValue(request)
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(new ParameterizedTypeReference<AiResponse<Boolean>>() {})
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Failed to update prompt config: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }

    @Override
    public Mono<AiResponse<TranslateResponse>> translateContent(TranslateRequest request, String token) {
        return performRequest(
            "/api/v1/ai/translate",
            request,
            token,
            new ParameterizedTypeReference<AiResponse<TranslateResponse>>() {}
        );
    }

    @Override
    public Mono<AiResponse<java.util.List<AiTaskTypeResponse>>> listTaskTypes(String token) {
        return aiWebClient.get()
            .uri("/api/v1/admin/ai/tasks")
            .header("Authorization", requireAuthorizationToken(token))
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(new ParameterizedTypeReference<AiResponse<java.util.List<AiTaskTypeResponse>>>() {})
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Failed to list task types: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }

    @Override
    public Mono<AiResponse<Integer>> createTaskType(TaskTypeCreateRequest request, String token) {
        return aiWebClient.post()
            .uri("/api/v1/admin/ai/tasks")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", requireAuthorizationToken(token))
            .bodyValue(request)
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(new ParameterizedTypeReference<AiResponse<Integer>>() {})
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Failed to create task type: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }

    @Override
    public Mono<AiResponse<Boolean>> updateTaskType(String code, TaskTypeUpdateRequest request, String token) {
        return aiWebClient.put()
            .uri("/api/v1/admin/ai/tasks/{code}", code)
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", requireAuthorizationToken(token))
            .bodyValue(request)
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(new ParameterizedTypeReference<AiResponse<Boolean>>() {})
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Failed to update task type: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }

    @Override
    public Mono<AiResponse<Boolean>> deleteTaskType(String code, String token) {
        return aiWebClient.delete()
            .uri("/api/v1/admin/ai/tasks/{code}", code)
            .header("Authorization", requireAuthorizationToken(token))
            .retrieve()
            .onStatus(status -> status.isError(), this::handleErrorResponse)
            .bodyToMono(new ParameterizedTypeReference<AiResponse<Boolean>>() {})
            .retryWhen(Retry.backoff(properties.getMaxRetries(), Duration.ofMillis(500)))
            .doOnError(error -> log.error("Failed to delete task type: {}", error.getMessage()))
            .onErrorResume(this::handleNonStreamError);
    }

    
    private String requireAuthorizationToken(String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("Authorization token is required for AI service requests");
        }
        return token;
    }

    /**
     * 执行通用请求
     */
    private <T, R> Mono<AiResponse<R>> performRequest(
        String uri,
        T request,
        String token,
        ParameterizedTypeReference<AiResponse<R>> responseType
    ) {
        return aiWebClient.post()
            .uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", requireAuthorizationToken(token))
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
