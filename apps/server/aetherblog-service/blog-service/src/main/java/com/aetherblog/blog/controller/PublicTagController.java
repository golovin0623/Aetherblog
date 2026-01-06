package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.Tag;
import com.aetherblog.blog.service.TagService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 博客前台标签接口
 */
@io.swagger.v3.oas.annotations.tags.Tag(name = "博客前台标签", description = "公开访问的标签接口")
@RestController
@RequestMapping("/v1/public/tags")
@RequiredArgsConstructor
public class PublicTagController {

    private final TagService tagService;

    @Operation(summary = "获取所有标签")
    @GetMapping
    public R<List<Tag>> list() {
        return R.ok(tagService.getAllTags());
    }
}
