package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.service.MediaService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * 媒体管理控制器
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §8.2-4 - 媒体管理模块
 */
@Tag(name = "媒体管理", description = "文件上传和管理接口")
@RestController
@RequestMapping("/v1/admin/media")
@RequiredArgsConstructor
public class MediaController {

    private final MediaService mediaService;

    @Operation(summary = "上传文件")
    @PostMapping("/upload")
    public R<MediaFile> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) Long uploaderId) {
        return R.ok(mediaService.upload(file, uploaderId));
    }

    @Operation(summary = "批量上传")
    @PostMapping("/upload/batch")
    public R<List<MediaFile>> uploadBatch(
            @RequestParam("files") List<MultipartFile> files,
            @RequestParam(required = false) Long uploaderId) {
        return R.ok(mediaService.uploadBatch(files, uploaderId));
    }

    @Operation(summary = "获取媒体列表")
    @GetMapping
    public R<PageResult<MediaFile>> list(
            @RequestParam(required = false) String fileType,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {
        return R.ok(mediaService.listPage(fileType, keyword, pageNum, pageSize));
    }

    @Operation(summary = "获取媒体详情")
    @GetMapping("/{id}")
    public R<MediaFile> getById(@PathVariable Long id) {
        return R.ok(mediaService.getById(id));
    }

    @Operation(summary = "更新媒体信息")
    @PutMapping("/{id}")
    public R<MediaFile> update(
            @PathVariable Long id,
            @RequestParam(required = false) String altText,
            @RequestParam(required = false) String originalName) {
        return R.ok(mediaService.update(id, altText, originalName));
    }

    @Operation(summary = "删除媒体")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        mediaService.delete(id);
        return R.ok();
    }

    @Operation(summary = "批量删除媒体")
    @DeleteMapping("/batch")
    public R<Void> batchDelete(@RequestBody List<Long> ids) {
        mediaService.batchDelete(ids);
        return R.ok();
    }

    @Operation(summary = "获取存储统计")
    @GetMapping("/stats")
    public R<Map<String, Object>> getStats() {
        return R.ok(mediaService.getStorageStats());
    }
}
