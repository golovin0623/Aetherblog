package com.aetherblog.blog.controller;

import com.aetherblog.ai.client.client.AiServiceClient;
import com.aetherblog.ai.client.dto.request.*;
import com.aetherblog.ai.client.dto.response.*;
import com.aetherblog.ai.client.dto.stream.StreamEvent;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * AI 服务 Controller
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Tag(name = "AI 服务", description = "AI 辅助工具接口（管理员专用）")
@Slf4j
@RestController
@RequestMapping("/api/v1/admin/ai")
@RequiredArgsConstructor
public class AiController {
    
    private final AiServiceClient aiServiceClient;
    
    /**
     * 生成文章摘要（非流式）
     */
    @Operation(summary = "生成文章摘要", description = "根据文章内容生成摘要（非流式）")
    @PostMapping("/summary")
    @PreAuthorize("hasRole('ADMIN')")
    public Mono<R<SummaryResponse>> generateSummary(@Valid @RequestBody SummaryRequest request) {
        log.info("Generating summary for content length: {}", request.getContent().length());
        return aiServiceClient.generateSummary(request)
            .map(response -> {
                if (response.isSuccess()) {
                    return R.ok(response.getData());
                } else {
                    return R.<SummaryResponse>fail(response.getErrorMessage());
                }
            })
            .onErrorResume(error -> {
                log.error("Failed to generate summary", error);
                return Mono.just(R.<SummaryResponse>fail(error.getMessage()));
            });
    }
    
    /**
     * 生成文章摘要（流式）
     */
    @Operation(summary = "生成文章摘要（流式）", description = "流式生成文章摘要，实时返回生成内容")
    @PostMapping(value = "/summary/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("hasRole('ADMIN')")
    public Flux<ServerSentEvent<StreamEvent>> generateSummaryStream(@Valid @RequestBody SummaryRequest request) {
        log.info("Generating summary stream for content length: {}", request.getContent().length());
        
        return aiServiceClient.generateSummaryStream(request)
            .map(event -> ServerSentEvent.<StreamEvent>builder()
                .id(String.valueOf(System.currentTimeMillis()))
                .event(event.getEvent())
                .data(event)
                .build())
            .concatWith(Flux.just(
                ServerSentEvent.<StreamEvent>builder()
                    .event("done")
                    .data(null)
                    .build()
            ))
            .doOnError(error -> log.error("Stream error", error))
            .onErrorResume(error -> Flux.just(
                ServerSentEvent.<StreamEvent>builder()
                    .event("error")
                    .data(null)
                    .build()
            ));
    }
    
    /**
     * 提取文章标签
     */
    @Operation(summary = "提取文章标签", description = "基于文章内容智能提取标签")
    @PostMapping("/tags")
    @PreAuthorize("hasRole('ADMIN')")
    public Mono<R<TagsResponse>> extractTags(@Valid @RequestBody TagsRequest request) {
        log.info("Extracting tags for content length: {}", request.getContent().length());
        return aiServiceClient.extractTags(request)
            .map(response -> {
                if (response.isSuccess()) {
                    return R.ok(response.getData());
                } else {
                    return R.<TagsResponse>fail(response.getErrorMessage());
                }
            })
            .onErrorResume(error -> {
                log.error("Failed to extract tags", error);
                return Mono.just(R.<TagsResponse>fail(error.getMessage()));
            });
    }
    
    /**
     * 生成标题建议
     */
    @Operation(summary = "生成标题建议", description = "基于文章内容生成多个标题建议")
    @PostMapping("/titles")
    @PreAuthorize("hasRole('ADMIN')")
    public Mono<R<TitlesResponse>> suggestTitles(@Valid @RequestBody TitlesRequest request) {
        log.info("Suggesting titles for content length: {}", request.getContent().length());
        return aiServiceClient.suggestTitles(request)
            .map(response -> {
                if (response.isSuccess()) {
                    return R.ok(response.getData());
                } else {
                    return R.<TitlesResponse>fail(response.getErrorMessage());
                }
            })
            .onErrorResume(error -> {
                log.error("Failed to suggest titles", error);
                return Mono.just(R.<TitlesResponse>fail(error.getMessage()));
            });
    }
    
    /**
     * 内容润色
     */
    @Operation(summary = "内容润色", description = "优化文章内容的语法、清晰度和风格")
    @PostMapping("/polish")
    @PreAuthorize("hasRole('ADMIN')")
    public Mono<R<PolishResponse>> polishContent(@Valid @RequestBody PolishRequest request) {
        log.info("Polishing content length: {}", request.getContent().length());
        return aiServiceClient.polishContent(request)
            .map(response -> {
                if (response.isSuccess()) {
                    return R.ok(response.getData());
                } else {
                    return R.<PolishResponse>fail(response.getErrorMessage());
                }
            })
            .onErrorResume(error -> {
                log.error("Failed to polish content", error);
                return Mono.just(R.<PolishResponse>fail(error.getMessage()));
            });
    }
    
    /**
     * 生成文章大纲
     */
    @Operation(summary = "生成文章大纲", description = "根据主题生成文章大纲")
    @PostMapping("/outline")
    @PreAuthorize("hasRole('ADMIN')")
    public Mono<R<OutlineResponse>> generateOutline(@Valid @RequestBody OutlineRequest request) {
        log.info("Generating outline for topic: {}", request.getTopic());
        return aiServiceClient.generateOutline(request)
            .map(response -> {
                if (response.isSuccess()) {
                    return R.ok(response.getData());
                } else {
                    return R.<OutlineResponse>fail(response.getErrorMessage());
                }
            })
            .onErrorResume(error -> {
                log.error("Failed to generate outline", error);
                return Mono.just(R.<OutlineResponse>fail(error.getMessage()));
            });
    }
    
    /**
     * 健康检查
     */
    @Operation(summary = "AI 服务健康检查", description = "检查 AI 服务是否可用")
    @GetMapping("/health")
    @PreAuthorize("hasRole('ADMIN')")
    public Mono<R<String>> healthCheck() {
        return Mono.just(R.ok("AI service is available"));
    }
}
