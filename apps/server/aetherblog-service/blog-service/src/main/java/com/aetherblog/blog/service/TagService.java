package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.Tag;
import java.util.List;

/**
 * 标签服务接口
 */
public interface TagService {
    List<Tag> getAllTags();
    Tag getTagById(Long id);
    Tag getTagBySlug(String slug);
    Tag createTag(Tag tag);
    Tag updateTag(Long id, Tag tag);
    void deleteTag(Long id);
    Tag getOrCreateTag(String name);
}
