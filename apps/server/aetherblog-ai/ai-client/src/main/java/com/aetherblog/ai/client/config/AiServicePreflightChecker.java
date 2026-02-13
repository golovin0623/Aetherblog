package com.aetherblog.ai.client.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class AiServicePreflightChecker implements ApplicationRunner {

    private static final ParameterizedTypeReference<Map<String, String>> MAP_TYPE =
            new ParameterizedTypeReference<>() {};

    private final AiServiceProperties properties;
    private final WebClient.Builder webClientBuilder;

    private volatile PreflightResult lastResult = PreflightResult.skipped(null, "AI 预检尚未执行");

    @Override
    public void run(ApplicationArguments args) {
        PreflightResult result = checkNow();
        if (result.skipped()) {
            log.warn("AI preflight skipped: {}", result.message());
            return;
        }
        if (result.success()) {
            log.info("AI preflight passed endpoint={} latencyMs={} message={}",
                    result.endpoint(), result.latencyMs(), result.message());
            return;
        }

        log.error("AI preflight failed endpoint={} failFast={} message={}",
                result.endpoint(), properties.isPreflightFailFast(), result.message());
        if (properties.isPreflightFailFast()) {
            throw new IllegalStateException("AI preflight failed: " + result.message());
        }
    }

    public PreflightResult checkNow() {
        if (!properties.isPreflightEnabled()) {
            PreflightResult skipped = PreflightResult.skipped(normalizeBaseUrl(properties.getBaseUrl()), "AI 预检被配置禁用");
            lastResult = skipped;
            return skipped;
        }

        PreflightResult result;
        try {
            result = doCheck();
        } catch (Exception exception) {
            result = PreflightResult.failed(normalizeBaseUrl(properties.getBaseUrl()), 0,
                    exception.getClass().getSimpleName() + ": " + exception.getMessage());
        }
        lastResult = result;
        return result;
    }

    public PreflightResult getLastResult() {
        return lastResult;
    }

    private PreflightResult doCheck() {
        String baseUrl = normalizeBaseUrl(properties.getBaseUrl());
        validateBaseUrl(baseUrl);

        long startedAt = System.currentTimeMillis();
        String endpoint = baseUrl + "/health";
        Map<String, String> payload = webClientBuilder
                .baseUrl(baseUrl)
                .build()
                .get()
                .uri("/health")
                .retrieve()
                .bodyToMono(MAP_TYPE)
                .timeout(Duration.ofMillis(properties.getPreflightTimeoutMs()))
                .block();
        long latency = Math.max(0, System.currentTimeMillis() - startedAt);

        String status = payload == null ? null : payload.get("status");
        if ("ok".equalsIgnoreCase(status) || "ready".equalsIgnoreCase(status)) {
            return PreflightResult.success(endpoint, latency, "AI 服务健康检查通过");
        }

        return PreflightResult.failed(endpoint, latency, "AI 服务健康检查返回异常状态: " + status);
    }

    private void validateBaseUrl(String baseUrl) {
        if (!StringUtils.hasText(baseUrl)) {
            throw new IllegalArgumentException("aetherblog.ai.base-url 不能为空");
        }
        if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
            throw new IllegalArgumentException("aetherblog.ai.base-url 必须以 http:// 或 https:// 开头");
        }
        if (baseUrl.contains("/api/v1/ai") || baseUrl.contains("/api/v1/admin")) {
            throw new IllegalArgumentException("aetherblog.ai.base-url 仅允许主机根地址，不能包含 API 前缀");
        }
    }

    private String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null) {
            return null;
        }
        String normalized = baseUrl.trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    public record PreflightResult(boolean success, boolean skipped, String endpoint, long latencyMs, String message) {
        public static PreflightResult success(String endpoint, long latencyMs, String message) {
            return new PreflightResult(true, false, endpoint, latencyMs, message);
        }

        public static PreflightResult failed(String endpoint, long latencyMs, String message) {
            return new PreflightResult(false, false, endpoint, latencyMs, message);
        }

        public static PreflightResult skipped(String endpoint, String message) {
            return new PreflightResult(true, true, endpoint, 0, message);
        }
    }
}
