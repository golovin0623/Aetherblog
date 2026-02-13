package com.aetherblog.ai.client.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * AI 服务配置属性
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@Component
@ConfigurationProperties(prefix = "aetherblog.ai")
public class AiServiceProperties {
    
    /**
     * AI 服务基础 URL
     * 默认: http://localhost:8000
     */
    private String baseUrl = "http://localhost:8000";
    
    /**
     * 连接超时（毫秒）
     */
    private int connectTimeout = 5000;
    
    /**
     * 读取超时（毫秒）
     * - 非流式接口: 30秒
     */
    private int readTimeout = 30000;
    
    /**
     * 流式接口读取超时（毫秒）
     * - 流式接口: 5分钟
     */
    private int streamReadTimeout = 300000;
    
    /**
     * 最大重试次数
     */
    private int maxRetries = 2;
    
    /**
     * 是否启用熔断器
     */
    private boolean circuitBreakerEnabled = true;
    
    /**
     * 熔断器失败阈值
     */
    private int circuitBreakerThreshold = 5;


    /**
     * 是否启用 AI 服务启动预检
     */
    private boolean preflightEnabled = true;

    /**
     * 预检失败时是否启动失败（fail-fast）
     */
    private boolean preflightFailFast = false;

    /**
     * 预检探活超时时间（毫秒）
     */
    private int preflightTimeoutMs = 3000;
}
