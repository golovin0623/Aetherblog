package com.aetherblog.ai.client.dto.response;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * AI 服务统一响应包装
 * 
 * @param <T> 响应数据类型
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class AiResponse<T> {
    
    /**
     * 是否成功
     */
    private boolean success;
    
    /**
     * 响应数据
     */
    private T data;
    
    /**
     * 错误码（失败时）
     */
    private String errorCode;
    
    /**
     * 错误信息（失败时）
     */
    private String errorMessage;
    
    /**
     * 请求 ID（用于追踪）
     */
    private String requestId;
    
    /**
     * 成功响应工厂方法
     */
    public static <T> AiResponse<T> success(T data) {
        return new AiResponse<>(true, data, null, null, null);
    }
    
    /**
     * 成功响应工厂方法（带 requestId）
     */
    public static <T> AiResponse<T> success(T data, String requestId) {
        return new AiResponse<>(true, data, null, null, requestId);
    }
    
    /**
     * 失败响应工厂方法
     */
    public static <T> AiResponse<T> error(String errorCode, String errorMessage) {
        return new AiResponse<>(false, null, errorCode, errorMessage, null);
    }
    
    /**
     * 失败响应工厂方法（带 requestId）
     */
    public static <T> AiResponse<T> error(String errorCode, String errorMessage, String requestId) {
        return new AiResponse<>(false, null, errorCode, errorMessage, requestId);
    }
}
