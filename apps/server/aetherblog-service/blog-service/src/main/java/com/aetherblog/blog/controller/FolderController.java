package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.MediaFolder;
import com.aetherblog.blog.service.FolderService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 文件夹管理控制器
 *
 * @ref 媒体库深度优化方案 - Phase 1: 文件夹层级管理
 * @author AI Assistant
 * @since 2.1.0
 */
@Slf4j
@RestController
@RequestMapping("/v1/admin/media/folders")
@RequiredArgsConstructor
@Tag(name = "文件夹管理", description = "媒体文件夹管理API")
public class FolderController {

    private final FolderService folderService;

    @GetMapping("/tree")
    @Operation(summary = "获取文件夹树", description = "获取完整的文件夹层级结构")
    public R<List<MediaFolder>> getTree(
            @Parameter(description = "用户ID (可选，用于权限过滤)")
            @RequestParam(required = false) Long userId
    ) {
        List<MediaFolder> tree = (userId != null)
                ? folderService.getTreeByUserId(userId)
                : folderService.getTree();
        return R.ok(tree);
    }

    @GetMapping("/{id}")
    @Operation(summary = "获取文件夹详情", description = "根据ID获取文件夹详细信息")
    public R<MediaFolder> getById(
            @Parameter(description = "文件夹ID", required = true)
            @PathVariable Long id
    ) {
        MediaFolder folder = folderService.getById(id);
        return R.ok(folder);
    }

    @GetMapping("/{id}/children")
    @Operation(summary = "获取子文件夹", description = "获取指定文件夹的直接子文件夹")
    public R<List<MediaFolder>> getChildren(
            @Parameter(description = "父文件夹ID", required = true)
            @PathVariable Long id
    ) {
        List<MediaFolder> children = folderService.getChildren(id);
        return R.ok(children);
    }

    @PostMapping
    @Operation(summary = "创建文件夹", description = "创建新的文件夹")
    public R<MediaFolder> create(
            @Valid @RequestBody CreateFolderRequest request
    ) {
        // TODO: 从SecurityContext获取当前用户ID
        Long currentUserId = 1L; // 临时硬编码，等待安全模块集成

        MediaFolder folder = folderService.create(
                request.getName(),
                request.getDescription(),
                request.getParentId(),
                currentUserId
        );

        return R.ok(folder);
    }

    @PutMapping("/{id}")
    @Operation(summary = "更新文件夹", description = "更新文件夹信息")
    public R<MediaFolder> update(
            @Parameter(description = "文件夹ID", required = true)
            @PathVariable Long id,
            @Valid @RequestBody UpdateFolderRequest request
    ) {
        // TODO: 从SecurityContext获取当前用户ID
        Long currentUserId = 1L;

        MediaFolder folder = folderService.update(
                id,
                request.getName(),
                request.getDescription(),
                request.getColor(),
                request.getIcon(),
                currentUserId
        );

        return R.ok(folder);
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "删除文件夹", description = "删除文件夹及其所有子文件夹和文件")
    public R<Void> delete(
            @Parameter(description = "文件夹ID", required = true)
            @PathVariable Long id
    ) {
        folderService.delete(id);
        return R.ok();
    }

    @PostMapping("/{id}/move")
    @Operation(summary = "移动文件夹", description = "将文件夹移动到新的父文件夹")
    public R<MediaFolder> move(
            @Parameter(description = "文件夹ID", required = true)
            @PathVariable Long id,
            @Valid @RequestBody MoveFolderRequest request
    ) {
        // TODO: 从SecurityContext获取当前用户ID
        Long currentUserId = 1L;

        MediaFolder folder = folderService.move(id, request.getTargetParentId(), currentUserId);
        return R.ok(folder);
    }

    @PostMapping("/{id}/refresh-stats")
    @Operation(summary = "刷新文件夹统计", description = "重新计算文件夹的文件数量和总大小")
    public R<Void> refreshStatistics(
            @Parameter(description = "文件夹ID", required = true)
            @PathVariable Long id
    ) {
        folderService.updateStatisticsRecursive(id);
        return R.ok();
    }

    // ==================== DTO 类 ====================

    /**
     * 创建文件夹请求
     */
    @Data
    public static class CreateFolderRequest {
        @NotBlank(message = "文件夹名称不能为空")
        @Size(max = 100, message = "文件夹名称不能超过100个字符")
        private String name;

        @Size(max = 500, message = "描述不能超过500个字符")
        private String description;

        private Long parentId;
    }

    /**
     * 更新文件夹请求
     */
    @Data
    public static class UpdateFolderRequest {
        @Size(max = 100, message = "文件夹名称不能超过100个字符")
        private String name;

        @Size(max = 500, message = "描述不能超过500个字符")
        private String description;

        @Size(max = 20, message = "颜色值不能超过20个字符")
        private String color;

        @Size(max = 50, message = "图标名称不能超过50个字符")
        private String icon;
    }

    /**
     * 移动文件夹请求
     */
    @Data
    public static class MoveFolderRequest {
        private Long targetParentId; // null表示移动到根目录
    }
}
