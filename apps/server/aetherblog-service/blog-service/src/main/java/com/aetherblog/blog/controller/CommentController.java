package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.Comment;
import com.aetherblog.blog.entity.Comment.CommentStatus;
import com.aetherblog.blog.service.CommentService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 评论管理控制器
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §3.2-11 - 评论管理模块
 */
@Tag(name = "评论管理", description = "评论审核和管理接口")
@RestController
@RequestMapping("/v1/admin/comments")
@RequiredArgsConstructor
public class CommentController {

    private final CommentService commentService;

    @Operation(summary = "获取待审核评论")
    @GetMapping("/pending")
    public R<PageResult<Comment>> listPending(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(commentService.listPending(pageNum, pageSize));
    }

    @Operation(summary = "获取所有评论")
    @GetMapping
    public R<PageResult<Comment>> listAll(
            @RequestParam(required = false) CommentStatus status,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(commentService.listAll(status, pageNum, pageSize));
    }

    @Operation(summary = "获取评论详情")
    @GetMapping("/{id}")
    public R<Comment> getById(@PathVariable Long id) {
        return R.ok(commentService.getById(id));
    }

    @Operation(summary = "审核通过")
    @PatchMapping("/{id}/approve")
    public R<Comment> approve(@PathVariable Long id) {
        return R.ok(commentService.approve(id));
    }

    @Operation(summary = "审核拒绝")
    @PatchMapping("/{id}/reject")
    public R<Comment> reject(@PathVariable Long id) {
        return R.ok(commentService.reject(id));
    }

    @Operation(summary = "标记为垃圾评论")
    @PatchMapping("/{id}/spam")
    public R<Comment> markAsSpam(@PathVariable Long id) {
        return R.ok(commentService.markAsSpam(id));
    }

    @Operation(summary = "还原评论")
    @PatchMapping("/{id}/restore")
    public R<Comment> restore(@PathVariable Long id) {
        return R.ok(commentService.restore(id));
    }

    @Operation(summary = "删除评论（移至回收站）")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        commentService.delete(id);
        return R.ok();
    }

    @Operation(summary = "彻底删除评论")
    @DeleteMapping("/{id}/permanent")
    public R<Void> permanentDelete(@PathVariable Long id) {
        commentService.permanentDelete(id);
        return R.ok();
    }

    @Operation(summary = "批量删除评论（移至回收站）")
    @DeleteMapping("/batch")
    public R<Void> batchDelete(@RequestBody List<Long> ids) {
        commentService.batchDelete(ids);
        return R.ok();
    }

    @Operation(summary = "批量彻底删除评论")
    @DeleteMapping("/batch/permanent")
    public R<Void> batchPermanentDelete(@RequestBody List<Long> ids) {
        commentService.batchPermanentDelete(ids);
        return R.ok();
    }

    @Operation(summary = "批量审核通过")
    @PatchMapping("/batch/approve")
    public R<Void> batchApprove(@RequestBody List<Long> ids) {
        commentService.batchApprove(ids);
        return R.ok();
    }
}
