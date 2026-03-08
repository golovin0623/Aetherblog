package com.aetherblog.blog.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;

import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import com.aetherblog.blog.service.UserService;
import com.aetherblog.common.security.service.JwtService;
import com.aetherblog.blog.service.AuthSessionService;
import com.aetherblog.blog.service.LoginSecurityService;
import com.aetherblog.api.dto.auth.LoginRequest;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class AuthControllerIpTest {

    @Mock
    private UserService userService;
    @Mock
    private JwtService jwtService;
    @Mock
    private AuthSessionService authSessionService;
    @Mock
    private LoginSecurityService loginSecurityService;
    @Mock
    private HttpServletRequest request;
    @Mock
    private HttpServletResponse response;

    @InjectMocks
    private AuthController authController;

    @Test
    public void testLogin_ShouldPrioritizeXRealIp() {
        // Arrange
        String spoofedIp = "1.1.1.1";
        String realIp = "2.2.2.2";

        // Simulating attacker sending X-Forwarded-For: 1.1.1.1
        // But Trusted Proxy (Nginx) sets X-Real-IP: 2.2.2.2
        // Simulate request coming from trusted proxy (Nginx on localhost)
        lenient().when(request.getRemoteAddr()).thenReturn("127.0.0.1");

        lenient().when(request.getHeader("X-Real-IP")).thenReturn(realIp);
        lenient().when(request.getHeader("X-Forwarded-For")).thenReturn(spoofedIp);

        LoginRequest loginRequest = new LoginRequest("admin", "password");

        // Act
        // We expect a BusinessException because the full login flow is not mocked.
        // This is acceptable as we are only testing the IP verification step.
        org.junit.jupiter.api.Assertions.assertThrows(com.aetherblog.common.core.exception.BusinessException.class, () -> {
            authController.login(loginRequest, request, response);
        });

        // Assert
        // Should use X-Real-IP (2.2.2.2)
        verify(loginSecurityService).assertLoginAllowed(eq("admin"), eq(realIp));
    }

    @Test
    public void testLogin_ShouldUseLastXForwardedForIp_WhenXRealIpMissing() {
        // Arrange
        String spoofedIp = "1.1.1.1";
        String realIp = "2.2.2.2";

        // Simulating attacker sending X-Forwarded-For: 1.1.1.1
        // Trusted Proxy appends real IP: 1.1.1.1, 2.2.2.2
        // And X-Real-IP is missing (maybe direct access or different proxy setup)
        // Simulate request coming from trusted proxy (Nginx on localhost)
        lenient().when(request.getRemoteAddr()).thenReturn("127.0.0.1");

        lenient().when(request.getHeader("X-Real-IP")).thenReturn(null);
        lenient().when(request.getHeader("x-forwarded-for")).thenReturn(null);
        lenient().when(request.getHeader("Proxy-Client-IP")).thenReturn(null);
        lenient().when(request.getHeader("WL-Proxy-Client-IP")).thenReturn(null);
        lenient().when(request.getHeader("X-Forwarded-For")).thenReturn(spoofedIp + ", " + realIp);

        LoginRequest loginRequest = new LoginRequest("admin", "password");

        // Act
        // We expect a BusinessException because the full login flow is not mocked.
        org.junit.jupiter.api.Assertions.assertThrows(com.aetherblog.common.core.exception.BusinessException.class, () -> {
            authController.login(loginRequest, request, response);
        });

        // Assert
        // Should use last IP in X-Forwarded-For (2.2.2.2)
        verify(loginSecurityService).assertLoginAllowed(eq("admin"), eq(realIp));
    }
}
