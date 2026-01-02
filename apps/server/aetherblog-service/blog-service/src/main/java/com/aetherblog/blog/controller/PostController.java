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

/**
 * 文章管理控制器
 */
@Tag(name = "文章管理", description = "文章CRUD接口")
@RestController
@RequestMapping("/v1/admin/posts")
@RequiredArgsConstructor
public class PostController {

    private final PostService postService;

    @Operation(summary = "获取文章列表")
    @GetMapping
    public R<PageResult<PostListResponse>> list(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(postService.getPublishedPosts(pageNum, pageSize));
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
