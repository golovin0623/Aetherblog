package com.aetherblog.ai.client.dto.stream;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * 流式错误
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(callSuper = true)
public class StreamError extends StreamEvent {
    
    /**
     * 错误数据
     */
    private ErrorData data;
    
    /**
     * 错误数据内容
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ErrorData {
        /**
         * 错误消息
         */
        private String message;
        
        /**
         * 错误码
         */
        private String code;
    }
    
    /**
     * 创建错误事件
     */
    public static StreamError of(String message) {
        StreamError error = new StreamError();
        error.setEvent("error");
        error.setData(new ErrorData(message, "AI_SERVICE_ERROR"));
        return error;
    }
}
