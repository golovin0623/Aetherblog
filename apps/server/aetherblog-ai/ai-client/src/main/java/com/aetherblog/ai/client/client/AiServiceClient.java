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
    Mono<AiResponse<SummaryResponse>> generateSummary(SummaryRequest request, String token);
    
    /**
     * 生成摘要（流式）
     * 
     * @param request 摘要请求
     * @return 流式事件流
     */
    Flux<StreamEvent> generateSummaryStream(SummaryRequest request, String token);
    
    /**
     * 提取标签
     * 
     * @param request 标签请求
     * @return 标签响应
     */
    Mono<AiResponse<TagsResponse>> extractTags(TagsRequest request, String token);
    
    /**
     * 生成标题建议
     * 
     * @param request 标题请求
     * @return 标题响应
     */
    Mono<AiResponse<TitlesResponse>> suggestTitles(TitlesRequest request, String token);
    
    /**
     * 内容润色
     * 
     * @param request 润色请求
     * @return 润色响应
     */
    Mono<AiResponse<PolishResponse>> polishContent(PolishRequest request, String token);
    
    /**
     * 生成文章大纲
     * 
     * @param request 大纲请求
     * @return 大纲响应
     */
    Mono<AiResponse<OutlineResponse>> generateOutline(OutlineRequest request, String token);

    /**
     * 获取 Prompt 配置
     *
     * @param taskType 任务类型
     * @param token 认证令牌
     * @return Prompt 配置响应
     */
    Mono<AiResponse<PromptConfigResponse>> getPromptConfig(String taskType, String token);

    /**
     * 获取所有 Prompt 配置
     *
     * @param token 认证令牌
     * @return Prompt 配置列表
     */
    Mono<AiResponse<java.util.List<PromptConfigResponse>>> listPromptConfigs(String token);

    /**
     * 更新 Prompt 配置
     *
     * @param taskType 任务类型
     * @param request 更新请求
     * @param token 认证令牌
     * @return 是否成功
     */
    Mono<AiResponse<Boolean>> updatePromptConfig(String taskType, PromptUpdateRequest request, String token);
}
