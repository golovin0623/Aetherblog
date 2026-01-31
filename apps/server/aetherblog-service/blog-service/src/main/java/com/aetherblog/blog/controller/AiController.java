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

import java.time.Duration;

/**
 * AI 服务 Controller
 * 
 * 注意：非流式接口使用同步返回以兼容 Servlet 环境
 * 流式接口仍使用 Flux 以支持 SSE
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Tag(name = "AI 服务", description = "AI 辅助工具接口（管理员专用）")
@Slf4j
@RestController
@RequestMapping("/v1/admin/ai")
@RequiredArgsConstructor
public class AiController {
    
    private final AiServiceClient aiServiceClient;
    
    /**
     * 生成文章摘要（非流式）- 同步返回
     */
    @Operation(summary = "生成文章摘要", description = "根据文章内容生成摘要（非流式）")
    @PostMapping("/summary")
    @PreAuthorize("hasRole('ADMIN')")
    public R<SummaryResponse> generateSummary(
            @Valid @RequestBody SummaryRequest request,
            @RequestHeader("Authorization") String token) {
        log.info("Generating summary for content length: {}", request.getContent().length());
        try {
            var response = aiServiceClient.generateSummary(request, token).block(Duration.ofSeconds(60));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to generate summary", error);
            return R.fail(error.getMessage());
        }
    }
    
    /**
     * 生成文章摘要（流式）
     */
    @Operation(summary = "生成文章摘要（流式）", description = "流式生成文章摘要，实时返回生成内容")
    @PostMapping(value = "/summary/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("hasRole('ADMIN')")
    public Flux<ServerSentEvent<StreamEvent>> generateSummaryStream(
            @Valid @RequestBody SummaryRequest request,
            @RequestHeader("Authorization") String token) {
        log.info("Generating summary stream for content length: {}", request.getContent().length());
        
        return aiServiceClient.generateSummaryStream(request, token)
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
     * 提取文章标签 - 同步返回
     */
    @Operation(summary = "提取文章标签", description = "基于文章内容智能提取标签")
    @PostMapping("/tags")
    @PreAuthorize("hasRole('ADMIN')")
    public R<TagsResponse> extractTags(
            @Valid @RequestBody TagsRequest request,
            @RequestHeader("Authorization") String token) {
        log.info("Extracting tags for content length: {}", request.getContent().length());
        try {
            var response = aiServiceClient.extractTags(request, token).block(Duration.ofSeconds(30));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to extract tags", error);
            return R.fail(error.getMessage());
        }
    }
    
    /**
     * 生成标题建议 - 同步返回
     */
    @Operation(summary = "生成标题建议", description = "基于文章内容生成多个标题建议")
    @PostMapping("/titles")
    @PreAuthorize("hasRole('ADMIN')")
    public R<TitlesResponse> suggestTitles(
            @Valid @RequestBody TitlesRequest request,
            @RequestHeader("Authorization") String token) {
        log.info("Suggesting titles for content length: {}", request.getContent().length());
        try {
            var response = aiServiceClient.suggestTitles(request, token).block(Duration.ofSeconds(30));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to suggest titles", error);
            return R.fail(error.getMessage());
        }
    }
    
    /**
     * 内容润色 - 同步返回
     */
    @Operation(summary = "内容润色", description = "优化文章内容的语法、清晰度和风格")
    @PostMapping("/polish")
    @PreAuthorize("hasRole('ADMIN')")
    public R<PolishResponse> polishContent(
            @Valid @RequestBody PolishRequest request,
            @RequestHeader("Authorization") String token) {
        log.info("Polishing content length: {}", request.getContent().length());
        try {
            var response = aiServiceClient.polishContent(request, token).block(Duration.ofSeconds(120));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to polish content", error);
            return R.fail(error.getMessage());
        }
    }
    
    /**
     * 生成文章大纲 - 同步返回
     */
    @Operation(summary = "生成文章大纲", description = "根据主题生成文章大纲")
    @PostMapping("/outline")
    @PreAuthorize("hasRole('ADMIN')")
    public R<OutlineResponse> generateOutline(
            @Valid @RequestBody OutlineRequest request,
            @RequestHeader("Authorization") String token) {
        log.info("Generating outline for topic: {}", request.getTopic());
        try {
            var response = aiServiceClient.generateOutline(request, token).block(Duration.ofSeconds(60));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to generate outline", error);
            return R.fail(error.getMessage());
        }
    }
    
    /**
     * 健康检查
     */
    @Operation(summary = "AI 服务健康检查", description = "检查 AI 服务是否可用")
    @GetMapping("/health")
    @PreAuthorize("hasRole('ADMIN')")
    public R<String> healthCheck() {
        return R.ok("AI service is available");
    }

    /**
     * 获取 Prompt 配置
     */
    @Operation(summary = "获取 Prompt 配置", description = "获取特定任务类型的默认和自定义 Prompt 配置")
    @GetMapping("/prompts/{taskType}")
    @PreAuthorize("hasRole('ADMIN')")
    public R<PromptConfigResponse> getPromptConfig(
            @PathVariable String taskType,
            @RequestHeader("Authorization") String token) {
        log.info("Getting prompt config for task type: {}", taskType);
        try {
            var response = aiServiceClient.getPromptConfig(taskType, token).block(Duration.ofSeconds(30));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to get prompt config", error);
            return R.fail(error.getMessage());
        }
    }

    /**
     * 获取所有 Prompt 配置
     */
    @Operation(summary = "获取所有 Prompt 配置", description = "一次性获取所有 AI 任务类型的 Prompt 配置")
    @GetMapping("/prompts")
    @PreAuthorize("hasRole('ADMIN')")
    public R<java.util.List<PromptConfigResponse>> listPromptConfigs(
            @RequestHeader("Authorization") String token) {
        log.info("Listing all prompt configs");
        try {
            var response = aiServiceClient.listPromptConfigs(token).block(Duration.ofSeconds(30));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to list prompt configs", error);
            return R.fail(error.getMessage());
        }
    }

    /**
     * 更新 Prompt 配置
     */
    @Operation(summary = "更新 Prompt 配置", description = "更新特定任务类型的自定义 Prompt 配置")
    @PutMapping("/prompts/{taskType}")
    @PreAuthorize("hasRole('ADMIN')")
    public R<Boolean> updatePromptConfig(
            @PathVariable String taskType,
            @Valid @RequestBody PromptUpdateRequest request,
            @RequestHeader("Authorization") String token) {
        log.info("Updating prompt config for task type: {}", taskType);
        try {
            var response = aiServiceClient.updatePromptConfig(taskType, request, token).block(Duration.ofSeconds(30));
            if (response != null && response.isSuccess()) {
                return R.ok(response.getData());
            } else {
                return R.fail(response != null ? response.getErrorMessage() : "AI service returned null");
            }
        } catch (Exception error) {
            log.error("Failed to update prompt config", error);
            return R.fail(error.getMessage());
        }
    }
}
