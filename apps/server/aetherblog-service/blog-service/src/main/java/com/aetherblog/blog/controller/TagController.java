package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.MediaTag;
import com.aetherblog.blog.entity.MediaFileTag.TagSource;
import com.aetherblog.blog.service.MediaTagService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/v1/admin/media/tags")
@RequiredArgsConstructor
@Tag(name = "标签管理", description = "媒体标签管理API")
public class TagController {

    private final MediaTagService mediaTagService;

    @GetMapping
    @Operation(summary = "获取所有标签")
    public R<List<MediaTag>> getAll() {
        return R.ok(mediaTagService.getAll());
    }

    @GetMapping("/popular")
    @Operation(summary = "获取热门标签")
    public R<List<MediaTag>> getPopular(@RequestParam(defaultValue = "10") int limit) {
        return R.ok(mediaTagService.getPopular(limit));
    }

    @GetMapping("/search")
    @Operation(summary = "搜索标签")
    public R<List<MediaTag>> search(@RequestParam String keyword) {
        return R.ok(mediaTagService.search(keyword));
    }

    @GetMapping("/{id}")
    @Operation(summary = "获取标签详情")
    public R<MediaTag> getById(@PathVariable Long id) {
        return R.ok(mediaTagService.getById(id));
    }

    @PostMapping
    @Operation(summary = "创建标签")
    public R<MediaTag> create(@Valid @RequestBody CreateTagRequest request) {
        MediaTag tag = mediaTagService.create(request.getName(), request.getDescription(), request.getColor());
        return R.ok(tag);
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新标签")
    public R<MediaTag> update(@PathVariable Long id, @Valid @RequestBody UpdateTagRequest request) {
        MediaTag tag = mediaTagService.update(id, request.getName(), request.getDescription(), request.getColor());
        return R.ok(tag);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除标签")
    public R<Void> delete(@PathVariable Long id) {
        mediaTagService.delete(id);
        return R.ok();
    }

    @GetMapping("/file/{fileId}")
    @Operation(summary = "获取文件的所有标签")
    public R<List<MediaTag>> getFileTags(@PathVariable Long fileId) {
        return R.ok(mediaTagService.getFileTags(fileId));
    }

    @PostMapping("/file/{fileId}")
    @Operation(summary = "给文件打标签")
    public R<Void> tagFile(@PathVariable Long fileId, @Valid @RequestBody TagFileRequest request) {
        Long userId = 1L; // TODO: 从SecurityContext获取
        mediaTagService.tagFile(fileId, request.getTagId(), userId, TagSource.MANUAL);
        return R.ok();
    }

    @PostMapping("/batch")
    @Operation(summary = "批量打标签")
    public R<Void> batchTag(@Valid @RequestBody BatchTagRequest request) {
        Long userId = 1L;
        mediaTagService.batchTag(request.getFileIds(), request.getTagId(), userId);
        return R.ok();
    }

    @DeleteMapping("/file/{fileId}/tag/{tagId}")
    @Operation(summary = "取消文件标签")
    public R<Void> untagFile(@PathVariable Long fileId, @PathVariable Long tagId) {
        mediaTagService.untagFile(fileId, tagId);
        return R.ok();
    }

    @Data
    public static class CreateTagRequest {
        @NotBlank(message = "标签名称不能为空")
        @Size(max = 50, message = "标签名称不能超过50个字符")
        private String name;

        @Size(max = 500, message = "描述不能超过500个字符")
        private String description;

        @Size(max = 20, message = "颜色值不能超过20个字符")
        private String color;
    }

    @Data
    public static class UpdateTagRequest {
        @Size(max = 50, message = "标签名称不能超过50个字符")
        private String name;

        @Size(max = 500, message = "描述不能超过500个字符")
        private String description;

        @Size(max = 20, message = "颜色值不能超过20个字符")
        private String color;
    }

    @Data
    public static class TagFileRequest {
        private Long tagId;
    }

    @Data
    public static class BatchTagRequest {
        @NotEmpty(message = "文件ID列表不能为空")
        private List<Long> fileIds;
        private Long tagId;
    }
}
