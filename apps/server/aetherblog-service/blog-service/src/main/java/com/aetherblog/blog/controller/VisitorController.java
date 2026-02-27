package com.aetherblog.blog.controller;

import com.aetherblog.blog.service.VisitorService;
import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.core.utils.IpUtils;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 访客统计公共控制器
 * 
 * @description 用于前台页面记录访问
 */
@Tag(name = "访客统计", description = "访客统计公共接口")
@RestController
@RequestMapping("/v1/public/visit")
@RequiredArgsConstructor
public class VisitorController {

    private final VisitorService visitorService;

    /**
     * 记录页面访问
     */
    @Operation(summary = "记录页面访问")
    @PostMapping
    public R<Void> recordVisit(
            HttpServletRequest request,
            @RequestBody VisitRequest body) {
        
        // Security Fix: Use IpUtils to prevent IP spoofing via X-Forwarded-For
        String ip = IpUtils.getIpAddr(request);
        String userAgent = request.getHeader("User-Agent");
        String referer = request.getHeader("Referer");
        
        visitorService.recordVisitAsync(ip, userAgent, referer, body.path(), body.postId());
        return R.ok();
    }

    /**
     * 获取今日统计（可选公开）
     */
    @Operation(summary = "获取今日访问统计")
    @GetMapping("/today")
    public R<Map<String, Long>> getTodayStats() {
        return R.ok(visitorService.getTodayStats());
    }

    public record VisitRequest(
        String path,
        Long postId
    ) {}
}
