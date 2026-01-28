package com.aetherblog.ai.client.client;

import com.aetherblog.ai.client.dto.stream.StreamEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * NDJSON 流式解析器
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StreamParser {
    
    private final ObjectMapper objectMapper;
    
    /**
     * 解析单行 NDJSON
     * 
     * @param line NDJSON 行
     * @return 流式事件
     */
    public Mono<StreamEvent> parse(String line) {
        if (line == null || line.isBlank()) {
            return Mono.empty();
        }
        
        try {
            StreamEvent event = objectMapper.readValue(line, StreamEvent.class);
            return Mono.just(event);
        } catch (Exception e) {
            log.warn("Failed to parse stream event: {}", line, e);
            return Mono.empty();
        }
    }
}
