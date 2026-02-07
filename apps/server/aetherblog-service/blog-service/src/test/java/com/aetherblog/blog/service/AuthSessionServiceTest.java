package com.aetherblog.blog.service;

import com.aetherblog.common.redis.service.RedisService;
import com.aetherblog.common.security.config.JwtConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthSessionServiceTest {

    @Mock
    private RedisService redisService;

    @Mock
    private JwtConfig jwtConfig;

    @InjectMocks
    private AuthSessionService authSessionService;

    @Test
    void issueRefreshToken_ShouldPersistHashedTokenWithTtl() {
        when(jwtConfig.getRefreshExpiration()).thenReturn(120000L);

        String refreshToken = authSessionService.issueRefreshToken(100L);

        assertNotNull(refreshToken);
        assertFalse(refreshToken.isBlank());
        verify(redisService).set(startsWith("auth:refresh:"), eq(100L), eq(120L), eq(TimeUnit.SECONDS));
    }

    @Test
    void rotateRefreshToken_WhenValid_ShouldRotateAndReturnSession() {
        when(jwtConfig.getRefreshExpiration()).thenReturn(120000L);
        when(redisService.get(anyString())).thenReturn(100L);

        AuthSessionService.RefreshSession session = authSessionService.rotateRefreshToken("old-refresh-token");

        assertNotNull(session);
        assertEquals(100L, session.userId());
        assertNotNull(session.refreshToken());
        assertNotEquals("old-refresh-token", session.refreshToken());
        verify(redisService).delete(startsWith("auth:refresh:"));
        verify(redisService).set(startsWith("auth:refresh:"), eq(100L), eq(120L), eq(TimeUnit.SECONDS));
    }

    @Test
    void rotateRefreshToken_WhenInvalid_ShouldReturnNull() {
        when(redisService.get(anyString())).thenReturn(null);

        AuthSessionService.RefreshSession session = authSessionService.rotateRefreshToken("expired-token");

        assertNull(session);
    }

    @Test
    void getAccessTokenMaxAgeSeconds_ShouldUseJwtExpiration() {
        when(jwtConfig.getExpiration()).thenReturn(60000L);

        assertEquals(60L, authSessionService.getAccessTokenMaxAgeSeconds());
    }
}
