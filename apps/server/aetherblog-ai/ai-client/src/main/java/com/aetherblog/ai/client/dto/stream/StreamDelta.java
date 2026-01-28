package com.aetherblog.ai.client.dto.stream;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

/**
 * 流式增量数据
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(callSuper = true)
public class StreamDelta extends StreamEvent {
    
    /**
     * 增量数据
     */
    private DeltaData data;
    
    /**
     * 增量数据内容
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DeltaData {
        /**
         * 文本片段
         */
        private String text;
    }
}
