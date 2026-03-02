package com.aetherblog.blog.controller;

import com.aetherblog.blog.service.VisitorService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
public class VisitorControllerIpTest {

    @Mock
    private VisitorService visitorService;

    @Mock
    private HttpServletRequest request;

    @InjectMocks
    private VisitorController visitorController;

    @Test
    public void testRecordVisit_ShouldPrioritizeXRealIp() {
        // Arrange
        String spoofedIp = "1.1.1.1";
        String realIp = "2.2.2.2";
        VisitorController.VisitRequest visitRequest = new VisitorController.VisitRequest("/test", 1L);

        // Simulating attacker sending X-Forwarded-For: 1.1.1.1
        // But Trusted Proxy (Nginx) sets X-Real-IP: 2.2.2.2
        lenient().when(request.getHeader("X-Real-IP")).thenReturn(realIp);
        // Current vulnerable implementation (getRealIp) prioritizes X-Forwarded-For
        lenient().when(request.getHeader("X-Forwarded-For")).thenReturn(spoofedIp);

        // Mock IpUtils behavior for completeness
        lenient().when(request.getHeader("x-forwarded-for")).thenReturn(null);
        lenient().when(request.getHeader("Proxy-Client-IP")).thenReturn(null);
        lenient().when(request.getHeader("WL-Proxy-Client-IP")).thenReturn(null);

        // Mock service method call (it's void)
        lenient().doNothing().when(visitorService).recordVisitAsync(any(), any(), any(), any(), any());

        // Act
        visitorController.recordVisit(request, visitRequest);

        // Assert
        // We expect the controller to have passed the REAL IP to the async method.
        // The fix ensures that IpUtils.getIpAddr(request) is used, which correctly prioritizes X-Real-IP.
        verify(visitorService).recordVisitAsync(eq(realIp), any(), any(), eq("/test"), eq(1L));
    }
}
