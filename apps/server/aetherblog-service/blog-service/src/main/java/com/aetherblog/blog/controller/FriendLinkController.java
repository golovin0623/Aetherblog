package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.FriendLink;
import com.aetherblog.blog.service.FriendLinkService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 友链管理控制器
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §8.2-7 - 友链管理模块
 */
@Tag(name = "友链管理", description = "友链CRUD接口")
@RestController
@RequestMapping("/v1/admin/friend-links")
@RequiredArgsConstructor
public class FriendLinkController {

    private final FriendLinkService friendLinkService;

    @Operation(summary = "获取所有友链")
    @GetMapping
    public R<List<FriendLink>> list() {
        return R.ok(friendLinkService.listAll());
    }

    @Operation(summary = "分页获取友链列表")
    @GetMapping("/page")
    public R<PageResult<FriendLink>> listPage(
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "10") int pageSize) {
        return R.ok(friendLinkService.listPage(pageNum, pageSize));
    }

    @Operation(summary = "获取友链详情")
    @GetMapping("/{id}")
    public R<FriendLink> getById(@PathVariable Long id) {
        return R.ok(friendLinkService.getById(id));
    }

    @Operation(summary = "创建友链")
    @PostMapping
    public R<FriendLink> create(@RequestBody FriendLink friendLink) {
        return R.ok(friendLinkService.create(friendLink));
    }

    @Operation(summary = "更新友链")
    @PutMapping("/{id}")
    public R<FriendLink> update(@PathVariable Long id, @RequestBody FriendLink friendLink) {
        return R.ok(friendLinkService.update(id, friendLink));
    }

    @Operation(summary = "删除友链")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        friendLinkService.delete(id);
        return R.ok();
    }

    @Operation(summary = "批量删除友链")
    @DeleteMapping("/batch")
    public R<Void> batchDelete(@RequestBody List<Long> ids) {
        friendLinkService.batchDelete(ids);
        return R.ok();
    }

    @Operation(summary = "切换可见状态")
    @PatchMapping("/{id}/toggle-visible")
    public R<FriendLink> toggleVisible(@PathVariable Long id) {
        return R.ok(friendLinkService.toggleVisible(id));
    }
}
