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
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        // Attack attempt: 1.2.3.4 (spoofed), 5.6.7.8 (real proxy IP)
        // Secure IpUtils takes "5.6.7.8" (last)
        request.addHeader("X-Forwarded-For", "1.2.3.4, 5.6.7.8");

        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        // Act
        activityEventService.recordEvent(
                "TEST_EVENT",
                EventCategory.SYSTEM,
                "Test Title",
                "Test Description",
                Collections.emptyMap(),
                EventStatus.INFO
        );

        // Assert
        ArgumentCaptor<ActivityEvent> eventCaptor = ArgumentCaptor.forClass(ActivityEvent.class);
        verify(activityEventRepository).save(eventCaptor.capture());

        ActivityEvent savedEvent = eventCaptor.getValue();
        // The SECURE implementation takes the last IP
        assertEquals("5.6.7.8", savedEvent.getIp(), "Should use the last IP in X-Forwarded-For chain");
    }

    @Test
    void recordEvent_ShouldPrioritizeXRealIp() {
        // Arrange
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Forwarded-For", "1.2.3.4, 5.6.7.8");
        request.addHeader("X-Real-IP", "9.9.9.9"); // Trusted Nginx IP

        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        // Act
        activityEventService.recordEvent(
                "TEST_EVENT",
                EventCategory.SYSTEM,
                "Test Title",
                "Test Description",
                Collections.emptyMap(),
                EventStatus.INFO
        );

        // Assert
        ArgumentCaptor<ActivityEvent> eventCaptor = ArgumentCaptor.forClass(ActivityEvent.class);
        verify(activityEventRepository).save(eventCaptor.capture());

        ActivityEvent savedEvent = eventCaptor.getValue();
        // The SECURE implementation prioritizes X-Real-IP
        assertEquals("9.9.9.9", savedEvent.getIp(), "Should prioritize X-Real-IP over X-Forwarded-For");
    }
}
