package com.aetherblog.blog.controller;

import com.aetherblog.api.dto.auth.RegisterRequest;
import com.aetherblog.common.security.annotation.RateLimit;
import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;

import java.lang.reflect.Method;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

public class RateLimitVerificationTest {

    @Test
    public void registerMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method registerMethod = AuthController.class.getMethod("register", RegisterRequest.class);

        RateLimit rateLimit = registerMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "Register method must have @RateLimit annotation");

        assertEquals("auth:register", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(5, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(600, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.IP, rateLimit.limitType(), "Rate limit type mismatch");
    }

    @Test
    public void changePasswordMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method changePasswordMethod = AuthController.class.getMethod("changePassword",
                com.aetherblog.common.security.domain.LoginUser.class,
                com.aetherblog.api.dto.auth.ChangePasswordRequest.class,
                jakarta.servlet.http.HttpServletRequest.class,
                jakarta.servlet.http.HttpServletResponse.class);

        RateLimit rateLimit = changePasswordMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "Change password method must have @RateLimit annotation");

        assertEquals("auth:change_password", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(5, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(300, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.USER, rateLimit.limitType(), "Rate limit type mismatch");
    }

    @Test
    public void mediaUploadMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method uploadMethod = MediaController.class.getMethod("upload",
                MultipartFile.class,
                Long.class,
                Long.class);

        RateLimit rateLimit = uploadMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "Media upload method must have @RateLimit annotation");

        assertEquals("media:upload", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(30, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(60, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.USER, rateLimit.limitType(), "Rate limit type mismatch");
    }

    @Test
    public void mediaUploadBatchMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method uploadBatchMethod = MediaController.class.getMethod("uploadBatch",
                List.class,
                Long.class,
                Long.class);

        RateLimit rateLimit = uploadBatchMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "Media upload batch method must have @RateLimit annotation");

        assertEquals("media:upload:batch", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(10, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(60, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.USER, rateLimit.limitType(), "Rate limit type mismatch");
    }
}
