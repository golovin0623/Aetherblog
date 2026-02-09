package com.aetherblog.blog.service;

import com.aetherblog.blog.dto.ActivityEventResponse;
import com.aetherblog.blog.entity.ActivityEvent.EventCategory;
import com.aetherblog.blog.entity.ActivityEvent.EventStatus;
import com.aetherblog.common.core.domain.PageResult;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 活动事件服务接口
 * 
 * @ref §8.2 - 仪表盘最近动态
 */
public interface ActivityEventService {

    /**
     * 记录活动事件
     * 
     * @param eventType    事件类型代码
     * @param category     事件分类
     * @param title        事件标题
     * @param description  事件描述
     * @param metadata     扩展元数据
     * @param status       事件状态
     */
    void recordEvent(String eventType, EventCategory category, String title, 
                     String description, Map<String, Object> metadata, EventStatus status);

    /**
     * 记录活动事件 (简化版，默认 INFO 状态)
     */
    void recordEvent(String eventType, EventCategory category, String title, 
                     String description, Map<String, Object> metadata);

    /**
     * 记录活动事件 (最简版)
     */
    void recordEvent(String eventType, EventCategory category, String title);

    /**
     * 获取最近N条活动事件
     */
    List<ActivityEventResponse> getRecentActivities(int limit);

    /**
     * 分页获取活动事件
     */
    PageResult<ActivityEventResponse> getActivities(
            EventCategory category,
            EventStatus status,
            LocalDateTime startTime,
            LocalDateTime endTime,
            int pageNum,
            int pageSize);

    /**
     * 获取指定用户的活动事件
     */
    PageResult<ActivityEventResponse> getActivitiesByUser(Long userId, int pageNum, int pageSize);
}
