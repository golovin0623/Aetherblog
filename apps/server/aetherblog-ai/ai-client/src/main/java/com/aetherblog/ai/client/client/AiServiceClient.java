package com.aetherblog.ai.client.client;

import com.aetherblog.ai.client.dto.request.*;
import com.aetherblog.ai.client.dto.response.*;
import com.aetherblog.ai.client.dto.stream.StreamEvent;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * AI 服务客户端接口
 * 
 * @author AI Assistant
 * @since 0.1.0
 */
public interface AiServiceClient {
    
    /**
     * 生成摘要（非流式）
     * 
     * @param request 摘要请求
     * @return 摘要响应
     */
    Mono<AiResponse<SummaryResponse>> generateSummary(SummaryRequest request);
    
    /**
     * 生成摘要（流式）
     * 
     * @param request 摘要请求
     * @return 流式事件流
     */
    Flux<StreamEvent> generateSummaryStream(SummaryRequest request);
    
    /**
     * 提取标签
     * 
     * @param request 标签请求
     * @return 标签响应
     */
    Mono<AiResponse<TagsResponse>> extractTags(TagsRequest request);
    
    /**
     * 生成标题建议
     * 
     * @param request 标题请求
     * @return 标题响应
     */
    Mono<AiResponse<TitlesResponse>> suggestTitles(TitlesRequest request);
    
    /**
     * 内容润色
     * 
     * @param request 润色请求
     * @return 润色响应
     */
    Mono<AiResponse<PolishResponse>> polishContent(PolishRequest request);
    
    /**
     * 生成文章大纲
     * 
     * @param request 大纲请求
     * @return 大纲响应
     */
    Mono<AiResponse<OutlineResponse>> generateOutline(OutlineRequest request);
}
