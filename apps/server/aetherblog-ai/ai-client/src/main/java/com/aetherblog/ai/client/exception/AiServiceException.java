package com.aetherblog.ai.client.exception;

/**
 * AI 服务异常基类
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
public class AiServiceException extends RuntimeException {
    
    public AiServiceException(String message) {
        super(message);
    }
    
    public AiServiceException(String message, Throwable cause) {
        super(message, cause);
    }
}
