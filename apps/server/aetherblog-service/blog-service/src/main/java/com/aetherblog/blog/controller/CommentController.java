package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.Comment;
import com.aetherblog.blog.entity.Comment.CommentStatus;
import com.aetherblog.blog.repository.CommentRepository;
import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.core.exception.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.*;

/**
 * 评论管理控制器
 */
@Tag(name = "评论管理", description = "评论CRUD接口")
@RestController
@RequestMapping("/v1/admin/comments")
@RequiredArgsConstructor
public class CommentController {

    private final CommentRepository commentRepository;

    @Operation(summary = "获取待审核评论")
    @GetMapping("/pending")
    public R<Page<Comment>> getPending(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return R.ok(commentRepository.findByStatus(CommentStatus.PENDING, PageRequest.of(page, size)));
    }

    @Operation(summary = "审核通过")
    @PatchMapping("/{id}/approve")
    public R<Comment> approve(@PathVariable Long id) {
        Comment comment = commentRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "评论不存在"));
        comment.setStatus(CommentStatus.APPROVED);
        return R.ok(commentRepository.save(comment));
    }

    @Operation(summary = "审核拒绝")
    @PatchMapping("/{id}/reject")
    public R<Comment> reject(@PathVariable Long id) {
        Comment comment = commentRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "评论不存在"));
        comment.setStatus(CommentStatus.REJECTED);
        return R.ok(commentRepository.save(comment));
    }

    @Operation(summary = "删除评论")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        commentRepository.deleteById(id);
        return R.ok();
    }
}
