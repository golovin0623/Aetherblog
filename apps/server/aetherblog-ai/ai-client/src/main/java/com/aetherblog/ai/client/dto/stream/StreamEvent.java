package com.aetherblog.ai.client.dto.stream;

import lombok.Data;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

/**
 * 流式事件基类
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "event")
@JsonSubTypes({
    @JsonSubTypes.Type(value = StreamDelta.class, name = "delta"),
    @JsonSubTypes.Type(value = StreamError.class, name = "error")
})
public abstract class StreamEvent {
    
    /**
     * 事件类型：delta/done/error
     */
    private String event;
    
    /**
     * 请求 ID
     */
    private String requestId;
}
