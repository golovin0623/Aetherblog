package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.FriendLink;
import com.aetherblog.blog.repository.FriendLinkRepository;
import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.core.exception.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 友链管理控制器
 */
@Tag(name = "友链管理", description = "友链CRUD接口")
@RestController
@RequestMapping("/v1/admin/friend-links")
@RequiredArgsConstructor
public class FriendLinkController {

    private final FriendLinkRepository friendLinkRepository;

    @Operation(summary = "获取所有友链")
    @GetMapping
    public R<List<FriendLink>> list() {
        return R.ok(friendLinkRepository.findAll());
    }

    @Operation(summary = "获取友链详情")
    @GetMapping("/{id}")
    public R<FriendLink> getById(@PathVariable Long id) {
        return R.ok(friendLinkRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "友链不存在")));
    }

    @Operation(summary = "创建友链")
    @PostMapping
    public R<FriendLink> create(@RequestBody FriendLink friendLink) {
        return R.ok(friendLinkRepository.save(friendLink));
    }

    @Operation(summary = "更新友链")
    @PutMapping("/{id}")
    public R<FriendLink> update(@PathVariable Long id, @RequestBody FriendLink friendLink) {
        FriendLink existing = friendLinkRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "友链不存在"));
        existing.setName(friendLink.getName());
        existing.setUrl(friendLink.getUrl());
        existing.setLogo(friendLink.getLogo());
        existing.setDescription(friendLink.getDescription());
        existing.setSortOrder(friendLink.getSortOrder());
        existing.setVisible(friendLink.getVisible());
        return R.ok(friendLinkRepository.save(existing));
    }

    @Operation(summary = "删除友链")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        friendLinkRepository.deleteById(id);
        return R.ok();
    }
}
