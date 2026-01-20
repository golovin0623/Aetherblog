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

import lombok.Data;

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
            @RequestParam(required = false) Long uploaderId,
            @RequestParam(required = false) Long folderId) {
        return R.ok(mediaService.upload(file, uploaderId, folderId));
    }

    @Operation(summary = "批量上传")
    @PostMapping("/upload/batch")
    public R<List<MediaFile>> uploadBatch(
            @RequestParam("files") List<MultipartFile> files,
            @RequestParam(required = false) Long uploaderId,
            @RequestParam(required = false) Long folderId) {
        return R.ok(mediaService.uploadBatch(files, uploaderId, folderId));
    }

    @Operation(summary = "获取媒体列表")
    @GetMapping
    public R<PageResult<MediaFile>> list(
            @RequestParam(required = false) String fileType,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long folderId,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {
        return R.ok(mediaService.listPage(fileType, keyword, folderId, pageNum, pageSize));
    }

    @Operation(summary = "获取存储统计")
    @GetMapping("/stats")
    public R<Map<String, Object>> getStats() {
        return R.ok(mediaService.getStorageStats());
    }

    @Operation(summary = "批量移动文件到指定文件夹")
    @PostMapping("/batch-move")
    public R<Void> batchMoveToFolder(@RequestBody BatchMoveRequest request) {
        mediaService.batchMoveToFolder(request.getFileIds(), request.getFolderId());
        return R.ok();
    }

    @Operation(summary = "批量删除媒体")
    @DeleteMapping("/batch")
    public R<Void> batchDelete(@RequestBody List<Long> ids) {
        mediaService.batchDelete(ids);
        return R.ok();
    }

    // ========== 回收站相关接口 ==========

    @Operation(summary = "获取回收站文件列表")
    @GetMapping("/trash")
    public R<PageResult<MediaFile>> listTrash(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {
        return R.ok(mediaService.listTrash(pageNum, pageSize));
    }

    @Operation(summary = "获取回收站文件数量")
    @GetMapping("/trash/count")
    public R<Long> getTrashCount() {
        return R.ok(mediaService.getTrashCount());
    }

    @Operation(summary = "批量从回收站恢复文件")
    @PostMapping("/trash/batch-restore")
    public R<Void> batchRestore(@RequestBody List<Long> ids) {
        mediaService.batchRestore(ids);
        return R.ok();
    }

    @Operation(summary = "批量彻底删除文件")
    @DeleteMapping("/trash/batch-permanent")
    public R<Void> batchPermanentDelete(@RequestBody List<Long> ids) {
        mediaService.batchPermanentDelete(ids);
        return R.ok();
    }

    @Operation(summary = "清空回收站")
    @DeleteMapping("/trash/empty")
    public R<Void> emptyTrash() {
        mediaService.emptyTrash();
        return R.ok();
    }

    // ========== 带 ID 的接口 (添加正则约束以避免路由冲突) ==========

    @Operation(summary = "获取媒体详情")
    @GetMapping("/{id:[0-9]+}")
    public R<MediaFile> getById(@PathVariable Long id) {
        return R.ok(mediaService.getById(id));
    }

    @Operation(summary = "更新媒体信息")
    @PutMapping("/{id:[0-9]+}")
    public R<MediaFile> update(
            @PathVariable Long id,
            @RequestParam(required = false) String altText,
            @RequestParam(required = false) String originalName) {
        return R.ok(mediaService.update(id, altText, originalName));
    }

    @Operation(summary = "删除媒体")
    @DeleteMapping("/{id:[0-9]+}")
    public R<Void> delete(@PathVariable Long id) {
        mediaService.delete(id);
        return R.ok();
    }

    @Operation(summary = "移动文件到指定文件夹")
    @PostMapping("/{id:[0-9]+}/move")
    public R<MediaFile> moveToFolder(
            @PathVariable Long id,
            @RequestParam(required = false) Long folderId) {
        return R.ok(mediaService.moveToFolder(id, folderId));
    }

    @Operation(summary = "从回收站恢复文件")
    @PostMapping("/{id:[0-9]+}/restore")
    public R<MediaFile> restore(@PathVariable Long id) {
        return R.ok(mediaService.restore(id));
    }

    @Operation(summary = "彻底删除文件（从回收站永久删除）")
    @DeleteMapping("/{id:[0-9]+}/permanent")
    public R<Void> permanentDelete(@PathVariable Long id) {
        mediaService.permanentDelete(id);
        return R.ok();
    }

    /**
     * 批量移动请求DTO
     */
    @Data
    public static class BatchMoveRequest {
        private List<Long> fileIds;
        private Long folderId;
    }
}
