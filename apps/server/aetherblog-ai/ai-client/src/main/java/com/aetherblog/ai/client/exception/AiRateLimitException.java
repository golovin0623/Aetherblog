package com.aetherblog.ai.client.exception;

/**
 * AI 服务限流异常
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
public class AiRateLimitException extends AiServiceException {
    
    public AiRateLimitException(String message) {
        super(message);
    }
}
