package com.aetherblog.ai.client.exception;

/**
 * AI 服务超时异常
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
public class AiTimeoutException extends AiServiceException {
    
    public AiTimeoutException(String message) {
        super(message);
    }
}
