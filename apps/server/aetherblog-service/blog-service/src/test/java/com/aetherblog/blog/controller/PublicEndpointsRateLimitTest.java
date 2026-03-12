package com.aetherblog.blog.controller;

import com.aetherblog.blog.dto.request.CreateCommentRequest;
import com.aetherblog.blog.dto.request.PostPasswordAccessRequest;
import com.aetherblog.common.security.annotation.RateLimit;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Method;
import static org.junit.jupiter.api.Assertions.*;

public class PublicEndpointsRateLimitTest {

    @Test
    public void publicCommentCreateMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method createMethod = PublicCommentController.class.getMethod("create", Long.class, CreateCommentRequest.class, HttpServletRequest.class);

        RateLimit rateLimit = createMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "PublicCommentController.create method must have @RateLimit annotation");

        assertEquals("public:comment", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(5, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(60, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.IP, rateLimit.limitType(), "Rate limit type mismatch");
    }

    @Test
    public void publicPostVerifyPasswordMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method verifyPasswordMethod = PublicPostController.class.getMethod("verifyPassword", String.class, PostPasswordAccessRequest.class);

        RateLimit rateLimit = verifyPasswordMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "PublicPostController.verifyPassword method must have @RateLimit annotation");

        assertEquals("public:post:password", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(5, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(60, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.IP, rateLimit.limitType(), "Rate limit type mismatch");
    }

    @Test
    public void visitorRecordVisitMethodShouldHaveRateLimitAnnotation() throws NoSuchMethodException {
        Method recordVisitMethod = VisitorController.class.getMethod("recordVisit", HttpServletRequest.class, VisitorController.VisitRequest.class);

        RateLimit rateLimit = recordVisitMethod.getAnnotation(RateLimit.class);
        assertNotNull(rateLimit, "VisitorController.recordVisit method must have @RateLimit annotation");

        assertEquals("public:visit", rateLimit.key(), "Rate limit key mismatch");
        assertEquals(30, rateLimit.count(), "Rate limit count mismatch");
        assertEquals(60, rateLimit.time(), "Rate limit time mismatch");
        assertEquals(RateLimit.LimitType.IP, rateLimit.limitType(), "Rate limit type mismatch");
    }
}
