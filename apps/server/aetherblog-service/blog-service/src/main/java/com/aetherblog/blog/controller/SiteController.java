package com.aetherblog.blog.controller;

import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 站点控制器
 */
@Tag(name = "站点信息", description = "站点公共信息接口")
@RestController
@RequestMapping("/v1/public/site")
@RequiredArgsConstructor
public class SiteController {

    @Operation(summary = "获取站点信息")
    @GetMapping("/info")
    public R<Map<String, Object>> getSiteInfo() {
        Map<String, Object> info = new HashMap<>();
        info.put("name", "AetherBlog");
        info.put("description", "智能博客系统");
        info.put("version", "0.1.0");
        info.put("author", "AetherBlog Team");
        return R.ok(info);
    }

    @Operation(summary = "获取站点统计")
    @GetMapping("/stats")
    public R<Map<String, Object>> getSiteStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("posts", 0);
        stats.put("categories", 0);
        stats.put("tags", 0);
        stats.put("comments", 0);
        stats.put("views", 0);
        return R.ok(stats);
    }
}
