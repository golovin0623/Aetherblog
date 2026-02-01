package com.aetherblog.blog.controller;

import com.aetherblog.blog.dto.request.CreateCommentRequest;
import com.aetherblog.blog.entity.Comment;
import com.aetherblog.blog.service.CommentService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@Tag(name = "博客前台评论", description = "公开访问的评论接口")
@RestController
@RequestMapping("/v1/public/comments")
@RequiredArgsConstructor
public class PublicCommentController {

    private final CommentService commentService;

    @Operation(summary = "获取文章评论")
    @GetMapping("/post/{postId}")
    public R<PageResult<Comment>> listByPost(
            @PathVariable Long postId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(commentService.listByPost(postId, pageNum, pageSize));
    }

    @Operation(summary = "发表评论")
    @PostMapping("/post/{postId}")
    public R<Comment> create(
            @PathVariable Long postId,
            @Valid @RequestBody CreateCommentRequest request,
            HttpServletRequest servletRequest) {

        Comment comment = new Comment();
        comment.setNickname(request.getNickname());
        comment.setEmail(request.getEmail());
        comment.setWebsite(request.getWebsite());
        comment.setContent(request.getContent());

        // 设置 IP 和 UserAgent
        comment.setIp(getClientIp(servletRequest));
        comment.setUserAgent(servletRequest.getHeader("User-Agent"));

        // 如果存在 parentId 则处理
        if (request.getParentId() != null) {
             return R.ok(commentService.reply(request.getParentId(), comment));
        } else {
             return R.ok(commentService.create(postId, comment));
        }
    }

    private String getClientIp(HttpServletRequest request) {
        String xfHeader = request.getHeader("X-Forwarded-For");
        if (xfHeader == null) {
            return request.getRemoteAddr();
        }
        return xfHeader.split(",")[0];
    }
}
