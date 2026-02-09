package com.aetherblog.blog.controller;

import com.aetherblog.blog.dto.ActivityEventResponse;
import com.aetherblog.blog.entity.ActivityEvent.EventCategory;
import com.aetherblog.blog.entity.ActivityEvent.EventStatus;
import com.aetherblog.blog.service.ActivityEventService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 活动事件控制器
 * 
 * @ref §8.2 - 仪表盘最近动态
 */
@Tag(name = "活动事件", description = "活动事件查询接口")
@RestController
@RequestMapping("/v1/admin/activities")
@RequiredArgsConstructor
public class ActivityEventController {

    private final ActivityEventService activityEventService;

    @Operation(summary = "获取最近动态", description = "获取最近N条活动事件，用于仪表盘展示")
    @GetMapping("/recent")
    public R<List<ActivityEventResponse>> getRecentActivities(
            @RequestParam(defaultValue = "10") int limit) {
        return R.ok(activityEventService.getRecentActivities(limit));
    }

    @Operation(summary = "获取活动事件列表", description = "分页获取活动事件，支持多种筛选条件")
    @GetMapping
    public R<PageResult<ActivityEventResponse>> getActivities(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startTime,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endTime,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {

        EventCategory eventCategory = null;
        if (category != null && !category.isEmpty()) {
            try {
                eventCategory = EventCategory.valueOf(category.toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // 忽略无效的分类参数
            }
        }

        EventStatus eventStatus = null;
        if (status != null && !status.isEmpty()) {
            try {
                eventStatus = EventStatus.valueOf(status.toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // 忽略无效的状态参数
            }
        }

        return R.ok(activityEventService.getActivities(
                eventCategory, eventStatus, startTime, endTime, pageNum, pageSize));
    }

    @Operation(summary = "获取用户活动事件", description = "获取指定用户的活动事件")
    @GetMapping("/user/{userId}")
    public R<PageResult<ActivityEventResponse>> getActivitiesByUser(
            @PathVariable Long userId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {
        return R.ok(activityEventService.getActivitiesByUser(userId, pageNum, pageSize));
    }
}
