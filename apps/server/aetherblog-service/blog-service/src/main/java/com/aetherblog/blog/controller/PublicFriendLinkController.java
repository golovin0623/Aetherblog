package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.FriendLink;
import com.aetherblog.blog.service.FriendLinkService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 友链公开接口控制器
 * 
 * @author AI Assistant
 * @since 1.0.0
 * @ref §3.1.7 - 友链展示模块
 */
@Tag(name = "友链公开接口", description = "前台友链展示接口")
@RestController
@RequestMapping("/v1/public/friend-links")
@RequiredArgsConstructor
public class PublicFriendLinkController {

    private final FriendLinkService friendLinkService;

    /**
     * 获取可见友链列表（前台展示用）
     * 仅返回 visible=true 的友链，按排序值升序排列
     */
    @Operation(summary = "获取可见友链列表")
    @GetMapping
    public R<List<FriendLink>> getVisibleFriendLinks() {
        return R.ok(friendLinkService.listVisible());
    }
}
