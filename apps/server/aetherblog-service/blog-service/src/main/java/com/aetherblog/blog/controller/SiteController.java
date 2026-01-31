package com.aetherblog.blog.controller;

import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.CommentRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import com.aetherblog.blog.service.SiteSettingService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 站点控制器
 * 
 * @ref §5.5 - 站点信息接口
 */
@Tag(name = "站点信息", description = "站点公共信息接口")
@RestController
@RequestMapping("/v1/public/site")
@RequiredArgsConstructor
public class SiteController {

    private final SiteSettingService siteSettingService;
    private final PostRepository postRepository;
    private final CategoryRepository categoryRepository;
    private final TagRepository tagRepository;
    private final CommentRepository commentRepository;
    private final com.aetherblog.blog.repository.UserRepository userRepository;

    @Operation(summary = "获取站点信息")
    @GetMapping("/info")
    public R<Map<String, Object>> getSiteInfo() {
        // 从数据库获取公开设置
        Map<String, Object> info = siteSettingService.getPublicSettings();
        
        // 覆盖为管理员信息
        injectAdminInfo(info);
        
        // 添加版本信息
        info.put("version", "0.1.0");
        
        return R.ok(info);
    }

    @Operation(summary = "获取站点统计")
    @GetMapping("/stats")
    public R<Map<String, Object>> getSiteStats() {
        Map<String, Object> stats = new HashMap<>();
        
        // 从数据库获取实际统计
        stats.put("posts", postRepository.count());
        stats.put("categories", categoryRepository.count());
        stats.put("tags", tagRepository.count());
        stats.put("comments", commentRepository.count());
        
        // 总访问量（后续可从 visit_records 表统计）
        stats.put("views", 0L);
        
        return R.ok(stats);
    }

    @Operation(summary = "获取博主信息")
    @GetMapping("/author")
    public R<Map<String, Object>> getAuthorInfo() {
        Map<String, Object> author = siteSettingService.getPublicSettingsByGroup("author");
        injectAdminInfo(author);
        return R.ok(author);
    }

    private void injectAdminInfo(Map<String, Object> map) {
        userRepository.findByRole(com.aetherblog.blog.entity.User.UserRole.ADMIN)
            .stream().findFirst().ifPresent(admin -> {
                if (admin.getNickname() != null) map.put("authorName", admin.getNickname());
                if (admin.getAvatar() != null) {
                    // 添加 /api 前缀以匹配 context-path 配置
                    String avatarPath = admin.getAvatar();
                    if (avatarPath.startsWith("/uploads")) {
                        avatarPath = "/api" + avatarPath;
                    }
                    map.put("authorAvatar", avatarPath);
                }
                if (admin.getBio() != null) map.put("authorBio", admin.getBio());
            });
    }
}
