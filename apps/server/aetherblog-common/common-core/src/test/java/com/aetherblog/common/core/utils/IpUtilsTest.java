package com.aetherblog.common.core.utils;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class IpUtilsTest {

    @Mock
    private HttpServletRequest request;

    @Test
    void shouldPrioritizeXRealIpOverXForwardedFor() {
        // Given
        String trustedIp = "10.0.0.1";
        String spoofedIp = "6.6.6.6";
        String forwardedFor = spoofedIp + ", " + trustedIp;

        // When
        when(request.getHeader("X-Real-IP")).thenReturn(trustedIp);
        // Ensure case-insensitive check if implementation changes to lowercase
        when(request.getHeader("x-real-ip")).thenReturn(trustedIp);

        when(request.getHeader("x-forwarded-for")).thenReturn(forwardedFor);

        // Then
        String ip = IpUtils.getIpAddr(request);
        assertEquals(trustedIp, ip, "Should prioritize X-Real-IP over X-Forwarded-For to prevent IP spoofing");
    }

    @Test
    void shouldFallbackToXForwardedForIfXRealIpIsMissing() {
        // Given
        String clientIp = "1.2.3.4";
        String forwardedFor = clientIp;

        // When
        when(request.getHeader("X-Real-IP")).thenReturn(null);
        when(request.getHeader("x-forwarded-for")).thenReturn(forwardedFor);

        // Then
        String ip = IpUtils.getIpAddr(request);
        assertEquals(clientIp, ip);
    }
}
