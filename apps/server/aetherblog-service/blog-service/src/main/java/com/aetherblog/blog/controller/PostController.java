package com.aetherblog.blog.controller;

import com.aetherblog.blog.dto.request.CreatePostRequest;
import com.aetherblog.blog.dto.response.PostDetailResponse;
import com.aetherblog.blog.dto.response.PostListResponse;
import com.aetherblog.blog.service.PostService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.format.annotation.DateTimeFormat;
import java.time.LocalDateTime;

/**
 * 文章管理控制器
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @see §4.3 - 业务服务实现
 */
@Tag(name = "文章管理", description = "文章CRUD接口")
@RestController
@RequestMapping("/v1/admin/posts")
@RequiredArgsConstructor
public class PostController {

    private final PostService postService;

    @Operation(summary = "获取文章列表", description = "支持多种复杂条件的动态筛选和分页查询")
    @GetMapping
    public R<PageResult<PostListResponse>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long tagId,
            @RequestParam(required = false) Integer minViewCount,
            @RequestParam(required = false) Integer maxViewCount,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime startDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime endDate,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(postService.getPostsForAdmin(
                status, keyword, categoryId, tagId, minViewCount, maxViewCount, startDate, endDate, pageNum, pageSize));
    }

    @Operation(summary = "获取文章详情")
    @GetMapping("/{id}")
    public R<PostDetailResponse> getById(@PathVariable Long id) {
        return R.ok(postService.getPostById(id));
    }

    @Operation(summary = "创建文章")
    @PostMapping
    public R<PostDetailResponse> create(@Valid @RequestBody CreatePostRequest request) {
        return R.ok(postService.createPost(request));
    }

    @Operation(summary = "更新文章")
    @PutMapping("/{id}")
    public R<PostDetailResponse> update(@PathVariable Long id, @Valid @RequestBody CreatePostRequest request) {
        return R.ok(postService.updatePost(id, request));
    }

    @Operation(summary = "自动保存/保存草稿")
    @PostMapping("/{id}/auto-save")
    public R<Void> saveDraft(@PathVariable Long id, @RequestBody CreatePostRequest request) {
        postService.saveDraft(id, request);
        return R.ok();
    }

    @Operation(summary = "删除文章")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        postService.deletePost(id);
        return R.ok();
    }

    @Operation(summary = "发布文章")
    @PatchMapping("/{id}/publish")
    public R<Void> publish(@PathVariable Long id) {
        postService.publishPost(id);
        return R.ok();
    }
}
