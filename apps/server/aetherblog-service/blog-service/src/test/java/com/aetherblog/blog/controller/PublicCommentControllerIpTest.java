package com.aetherblog.blog.controller;

import com.aetherblog.blog.dto.request.CreateCommentRequest;
import com.aetherblog.blog.entity.Comment;
import com.aetherblog.blog.service.CommentService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class PublicCommentControllerIpTest {

    @Mock
    private CommentService commentService;

    @Mock
    private HttpServletRequest request;

    @InjectMocks
    private PublicCommentController publicCommentController;

    @Test
    public void testCreate_ShouldPrioritizeXRealIp() {
        // Arrange
        Long postId = 1L;
        String spoofedIp = "1.1.1.1";
        String realIp = "2.2.2.2";
        CreateCommentRequest createCommentRequest = new CreateCommentRequest();
        createCommentRequest.setNickname("TestUser");
        createCommentRequest.setContent("Test Content");

        // Simulating attacker sending X-Forwarded-For: 1.1.1.1
        // But Trusted Proxy (Nginx) sets X-Real-IP: 2.2.2.2
        lenient().when(request.getHeader("X-Real-IP")).thenReturn(realIp);
        // Current implementation uses X-Forwarded-For directly if available
        lenient().when(request.getHeader("X-Forwarded-For")).thenReturn(spoofedIp);
        // Also mock lower case as IpUtils checks both
        lenient().when(request.getHeader("x-forwarded-for")).thenReturn(null);

        // Act
        publicCommentController.create(postId, createCommentRequest, request);

        // Assert
        ArgumentCaptor<Comment> commentCaptor = ArgumentCaptor.forClass(Comment.class);
        verify(commentService).create(eq(postId), commentCaptor.capture());

        // This assertion should FAIL with current implementation because it returns spoofedIp (1.1.1.1)
        // But we want it to be realIp (2.2.2.2) because IpUtils prefers X-Real-IP
        assertEquals(realIp, commentCaptor.getValue().getIp(), "Should prioritize X-Real-IP over X-Forwarded-For");
    }

    @Test
    public void testCreate_ShouldUseLastXForwardedForIp_WhenXRealIpMissing() {
        // Arrange
        Long postId = 1L;
        String spoofedIp = "1.1.1.1";
        String realIp = "2.2.2.2";
        CreateCommentRequest createCommentRequest = new CreateCommentRequest();
        createCommentRequest.setNickname("TestUser");
        createCommentRequest.setContent("Test Content");

        lenient().when(request.getHeader("X-Real-IP")).thenReturn(null);
        lenient().when(request.getHeader("x-forwarded-for")).thenReturn(null);
        lenient().when(request.getHeader("Proxy-Client-IP")).thenReturn(null);
        lenient().when(request.getHeader("WL-Proxy-Client-IP")).thenReturn(null);

        // If X-Real-IP is missing, IpUtils falls back to X-Forwarded-For and takes the LAST IP.
        // Current implementation takes the FIRST IP.
        lenient().when(request.getHeader("X-Forwarded-For")).thenReturn(spoofedIp + ", " + realIp);

        // Act
        publicCommentController.create(postId, createCommentRequest, request);

        // Assert
        ArgumentCaptor<Comment> commentCaptor = ArgumentCaptor.forClass(Comment.class);
        verify(commentService).create(eq(postId), commentCaptor.capture());

        // This assertion should FAIL with current implementation
        assertEquals(realIp, commentCaptor.getValue().getIp(), "Should use last IP from X-Forwarded-For list");
    }
}
