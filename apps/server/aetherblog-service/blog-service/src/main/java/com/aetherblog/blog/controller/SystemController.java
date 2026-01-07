package com.aetherblog.blog.controller;

import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.time.ZonedDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;

/**
 * 系统管理控制器
 * 
 * 提供系统级管理 API
 */
@Tag(name = "系统管理", description = "系统管理相关接口")
@RestController
@RequestMapping("/v1/admin/system")
public class SystemController {

    @Operation(summary = "获取服务器时间")
    @GetMapping("/time")
    public R<Map<String, Object>> getServerTime() {
        Map<String, Object> result = new HashMap<>();
        
        ZonedDateTime now = ZonedDateTime.now();
        ZoneId zone = ZoneId.systemDefault();
        
        result.put("timestamp", now.toInstant().toString());
        result.put("timezone", zone.getId());
        result.put("offsetSeconds", now.getOffset().getTotalSeconds());
        
        return R.ok(result);
    }
}
