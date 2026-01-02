package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.service.PostService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 归档控制器
 */
@Tag(name = "归档", description = "文章归档接口")
@RestController
@RequestMapping("/v1/public/archives")
@RequiredArgsConstructor
public class ArchiveController {

    private final PostService postService;

    @Operation(summary = "获取归档列表")
    @GetMapping
    public R<Map<String, List<ArchiveItem>>> getArchives() {
        // 获取所有已发布文章按年月分组
        var posts = postService.getAllPublishedPosts();
        
        var archives = posts.stream()
                .map(post -> new ArchiveItem(
                        post.getId(),
                        post.getTitle(),
                        post.getSlug(),
                        post.getPublishedAt() != null ? post.getPublishedAt().toLocalDate() : LocalDate.now()
                ))
                .collect(Collectors.groupingBy(
                        item -> item.date().getYear() + "-" + String.format("%02d", item.date().getMonthValue())
                ));
        
        return R.ok(archives);
    }

    @Operation(summary = "获取归档统计")
    @GetMapping("/stats")
    public R<List<ArchiveStats>> getArchiveStats() {
        // 简化实现：返回每月文章数统计
        return R.ok(List.of(
                new ArchiveStats("2024-01", 12),
                new ArchiveStats("2023-12", 8),
                new ArchiveStats("2023-11", 15)
        ));
    }

    public record ArchiveItem(Long id, String title, String slug, LocalDate date) {}
    
    public record ArchiveStats(String month, int count) {}
}
