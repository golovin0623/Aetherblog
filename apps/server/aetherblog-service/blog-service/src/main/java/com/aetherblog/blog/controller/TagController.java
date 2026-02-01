package com.aetherblog.blog.controller;

import com.aetherblog.blog.entity.Tag;
import com.aetherblog.blog.service.TagService;
import com.aetherblog.common.core.domain.R;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 标签管理控制器
 */
@io.swagger.v3.oas.annotations.tags.Tag(name = "标签管理", description = "文章标签管理接口")
@RestController("blogTagController")
@RequestMapping("/v1/admin/tags")
@RequiredArgsConstructor
public class TagController {

    private final TagService tagService;

    @Operation(summary = "获取所有标签")
    @GetMapping
    public R<List<Tag>> list() {
        return R.ok(tagService.getAllTags());
    }

    @Operation(summary = "获取标签详情")
    @GetMapping("/{id}")
    public R<Tag> getById(@PathVariable Long id) {
        return R.ok(tagService.getTagById(id));
    }

    @Operation(summary = "创建标签")
    @PostMapping
    public R<Tag> create(@RequestBody Tag tag) {
        return R.ok(tagService.createTag(tag));
    }

    @Operation(summary = "更新标签")
    @PutMapping("/{id}")
    public R<Tag> update(@PathVariable Long id, @RequestBody Tag tag) {
        return R.ok(tagService.updateTag(id, tag));
    }

    @Operation(summary = "删除标签")
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        tagService.deleteTag(id);
        return R.ok();
    }
}
