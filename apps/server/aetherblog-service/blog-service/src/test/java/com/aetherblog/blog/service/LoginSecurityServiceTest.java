package com.aetherblog.blog.service;

import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.redis.service.RedisService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LoginSecurityServiceTest {

    @Mock
    private RedisService redisService;

    @InjectMocks
    private LoginSecurityService loginSecurityService;

    @Test
    void assertLoginAllowed_WhenLocked_ShouldThrow() {
        when(redisService.hasKey(startsWith("auth:login:lock:"))).thenReturn(true);

        BusinessException exception = assertThrows(BusinessException.class,
                () -> loginSecurityService.assertLoginAllowed("Admin", "127.0.0.1"));

        assertEquals(429, exception.getCode());
    }

    @Test
    void recordFailedAttempt_FirstFailure_ShouldSetWindowExpiration() {
        when(redisService.increment(startsWith("auth:login:fail:"), org.mockito.ArgumentMatchers.eq(1L))).thenReturn(1L);

        loginSecurityService.recordFailedAttempt("Admin", "127.0.0.1");

        verify(redisService).expire(startsWith("auth:login:fail:"), org.mockito.ArgumentMatchers.eq(900L), org.mockito.ArgumentMatchers.eq(TimeUnit.SECONDS));
    }

    @Test
    void recordFailedAttempt_ThresholdReached_ShouldSetLockKey() {
        when(redisService.increment(startsWith("auth:login:fail:"), org.mockito.ArgumentMatchers.eq(1L))).thenReturn(5L);

        loginSecurityService.recordFailedAttempt("Admin", "127.0.0.1");

        verify(redisService).set(startsWith("auth:login:lock:"), org.mockito.ArgumentMatchers.eq("1"), org.mockito.ArgumentMatchers.eq(900L), org.mockito.ArgumentMatchers.eq(TimeUnit.SECONDS));
    }
}
