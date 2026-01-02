package com.aetherblog.blog.controller;

import com.aetherblog.blog.dto.response.PostDetailResponse;
import com.aetherblog.blog.dto.response.PostListResponse;
import com.aetherblog.blog.service.PostService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 博客前台文章接口
 */
@Tag(name = "博客前台", description = "公开访问的博客接口")
@RestController
@RequestMapping("/v1/public/posts")
@RequiredArgsConstructor
public class PublicPostController {

    private final PostService postService;

    @Operation(summary = "获取已发布文章列表")
    @GetMapping
    public R<PageResult<PostListResponse>> list(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(postService.getPublishedPosts(pageNum, pageSize));
    }

    @Operation(summary = "获取文章详情")
    @GetMapping("/{slug}")
    public R<PostDetailResponse> getBySlug(@PathVariable String slug) {
        PostDetailResponse post = postService.getPostBySlug(slug);
        // 增加阅读量
        postService.incrementViewCount(post.getId());
        return R.ok(post);
    }

    @Operation(summary = "获取分类下文章")
    @GetMapping("/category/{categoryId}")
    public R<PageResult<PostListResponse>> getByCategory(
            @PathVariable Long categoryId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(postService.getPostsByCategory(categoryId, pageNum, pageSize));
    }

    @Operation(summary = "获取标签下文章")
    @GetMapping("/tag/{tagId}")
    public R<PageResult<PostListResponse>> getByTag(
            @PathVariable Long tagId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(postService.getPostsByTag(tagId, pageNum, pageSize));
    }
}
