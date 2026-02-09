package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.dto.ActivityEventResponse;
import com.aetherblog.blog.entity.ActivityEvent;
import com.aetherblog.blog.entity.ActivityEvent.EventCategory;
import com.aetherblog.blog.entity.ActivityEvent.EventStatus;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.ActivityEventRepository;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.blog.service.ActivityEventService;
import com.aetherblog.common.core.domain.PageResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Async;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 活动事件服务实现
 * 
 * @ref §8.2 - 仪表盘最近动态
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ActivityEventServiceImpl implements ActivityEventService {

    private final ActivityEventRepository activityEventRepository;
    private final UserRepository userRepository;

    @Override
    @Async
    @Transactional
    public void recordEvent(String eventType, EventCategory category, String title,
                            String description, Map<String, Object> metadata, EventStatus status) {
        try {
            ActivityEvent event = ActivityEvent.builder()
                    .eventType(eventType)
                    .eventCategory(category)
                    .title(title)
                    .description(description)
                    .metadata(metadata)
                    .status(status)
                    .ip(getClientIp())
                    .user(getCurrentUser())
                    .build();

            activityEventRepository.save(event);
            log.debug("Activity event recorded: {} - {}", eventType, title);
        } catch (Exception e) {
            log.error("Failed to record activity event: {} - {}", eventType, title, e);
        }
    }

    @Override
    @Async
    @Transactional
    public void recordEvent(String eventType, EventCategory category, String title,
                            String description, Map<String, Object> metadata) {
        recordEvent(eventType, category, title, description, metadata, EventStatus.INFO);
    }

    @Override
    @Async
    @Transactional
    public void recordEvent(String eventType, EventCategory category, String title) {
        recordEvent(eventType, category, title, null, null, EventStatus.INFO);
    }

    @Override
    public List<ActivityEventResponse> getRecentActivities(int limit) {
        PageRequest pageRequest = PageRequest.of(0, limit);
        List<ActivityEvent> events = activityEventRepository
                .findTopNByOrderByCreatedAtDesc(pageRequest);
        return events.stream()
                .map(this::toResponse)
                .collect(Collectors.toList());
    }

    @Override
    public PageResult<ActivityEventResponse> getActivities(
            EventCategory category,
            EventStatus status,
            LocalDateTime startTime,
            LocalDateTime endTime,
            int pageNum,
            int pageSize) {

        PageRequest pageRequest = PageRequest.of(pageNum - 1, pageSize);
        Page<ActivityEvent> page;

        if (startTime != null && endTime != null) {
            page = activityEventRepository.findByDateRange(startTime, endTime, pageRequest);
        } else if (category != null && status != null) {
            page = activityEventRepository.findByEventCategoryAndStatusOrderByCreatedAtDesc(
                    category, status, pageRequest);
        } else if (category != null) {
            page = activityEventRepository.findByEventCategoryOrderByCreatedAtDesc(category, pageRequest);
        } else if (status != null) {
            page = activityEventRepository.findByStatusOrderByCreatedAtDesc(status, pageRequest);
        } else {
            page = activityEventRepository.findAllOrderByCreatedAtDesc(pageRequest);
        }

        List<ActivityEventResponse> list = page.getContent().stream()
                .map(this::toResponse)
                .collect(Collectors.toList());

        return PageResult.of(list, page.getTotalElements(), pageNum, pageSize);
    }

    @Override
    public PageResult<ActivityEventResponse> getActivitiesByUser(Long userId, int pageNum, int pageSize) {
        PageRequest pageRequest = PageRequest.of(pageNum - 1, pageSize);
        Page<ActivityEvent> page = activityEventRepository.findByUserIdOrderByCreatedAtDesc(userId, pageRequest);

        List<ActivityEventResponse> list = page.getContent().stream()
                .map(this::toResponse)
                .collect(Collectors.toList());

        return PageResult.of(list, page.getTotalElements(), pageNum, pageSize);
    }

    /**
     * 转换为响应 DTO
     */
    private ActivityEventResponse toResponse(ActivityEvent event) {
        ActivityEventResponse.UserInfo userInfo = null;
        if (event.getUser() != null) {
            User user = event.getUser();
            userInfo = ActivityEventResponse.UserInfo.builder()
                    .id(user.getId())
                    .username(user.getUsername())
                    .nickname(user.getNickname())
                    .avatar(user.getAvatar())
                    .build();
        }

        return ActivityEventResponse.builder()
                .id(event.getId())
                .eventType(event.getEventType())
                .eventCategory(event.getEventCategory().name().toLowerCase())
                .title(event.getTitle())
                .description(event.getDescription())
                .metadata(event.getMetadata())
                .user(userInfo)
                .ip(event.getIp())
                .status(event.getStatus().name())
                .createdAt(event.getCreatedAt())
                .build();
    }

    /**
     * 获取当前登录用户
     */
    private User getCurrentUser() {
        try {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getPrincipal())) {
                String username = auth.getName();
                return userRepository.findByUsername(username).orElse(null);
            }
        } catch (Exception e) {
            log.debug("Failed to get current user", e);
        }
        return null;
    }

    /**
     * 获取客户端 IP
     */
    private String getClientIp() {
        try {
            ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attrs != null) {
                HttpServletRequest request = attrs.getRequest();
                String xForwardedFor = request.getHeader("X-Forwarded-For");
                if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
                    return xForwardedFor.split(",")[0].trim();
                }
                String xRealIp = request.getHeader("X-Real-IP");
                if (xRealIp != null && !xRealIp.isEmpty()) {
                    return xRealIp;
                }
                return request.getRemoteAddr();
            }
        } catch (Exception e) {
            log.debug("Failed to get client IP", e);
        }
        return null;
    }
}
