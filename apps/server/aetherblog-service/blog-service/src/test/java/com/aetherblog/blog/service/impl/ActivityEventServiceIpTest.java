package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.ActivityEvent;
import com.aetherblog.blog.entity.ActivityEvent.EventCategory;
import com.aetherblog.blog.entity.ActivityEvent.EventStatus;
import com.aetherblog.blog.repository.ActivityEventRepository;
import com.aetherblog.blog.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ActivityEventServiceIpTest {

    @Mock
    private ActivityEventRepository activityEventRepository;

    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private ActivityEventServiceImpl activityEventService;

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void recordEvent_ShouldUseTrustedIp_WhenXForwardedForIsPresent() {
        // 准备
        MockHttpServletRequest request = new MockHttpServletRequest();
        // 攻击尝试：1.2.3.4 (伪造), 5.6.7.8 (真实的代理 IP)
        // 安全的 IpUtils 会取 "5.6.7.8" (最后一个)
        request.addHeader("X-Forwarded-For", "1.2.3.4, 5.6.7.8");

        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        // 执行
        activityEventService.recordEvent(
                "TEST_EVENT",
                EventCategory.SYSTEM,
                "Test Title",
                "Test Description",
                Collections.emptyMap(),
                EventStatus.INFO
        );

        // 断言
        ArgumentCaptor<ActivityEvent> eventCaptor = ArgumentCaptor.forClass(ActivityEvent.class);
        verify(activityEventRepository).save(eventCaptor.capture());

        ActivityEvent savedEvent = eventCaptor.getValue();
        // 安全实现应获取最后一个 IP
        assertEquals("5.6.7.8", savedEvent.getIp(), "Should use the last IP in X-Forwarded-For chain");
    }

    @Test
    void recordEvent_ShouldPrioritizeXRealIp() {
        // 准备
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Forwarded-For", "1.2.3.4, 5.6.7.8");
        request.addHeader("X-Real-IP", "9.9.9.9"); // 信任的 Nginx IP

        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        // 执行
        activityEventService.recordEvent(
                "TEST_EVENT",
                EventCategory.SYSTEM,
                "Test Title",
                "Test Description",
                Collections.emptyMap(),
                EventStatus.INFO
        );

        // 断言
        ArgumentCaptor<ActivityEvent> eventCaptor = ArgumentCaptor.forClass(ActivityEvent.class);
        verify(activityEventRepository).save(eventCaptor.capture());

        ActivityEvent savedEvent = eventCaptor.getValue();
        // 安全实现应优先使用 X-Real-IP
        assertEquals("9.9.9.9", savedEvent.getIp(), "Should prioritize X-Real-IP over X-Forwarded-For");
    }
}
