package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.MediaTag;
import com.aetherblog.blog.entity.MediaFileTag.TagSource;

import java.util.List;

/**
 * 标签服务接口
 *
 * @ref 媒体库深度优化方案 - Phase 2: 智能标签系统
 * @author AI Assistant
 * @since 2.2.0
 */
public interface MediaTagService {

    MediaTag create(String name, String description, String color);
    MediaTag update(Long id, String name, String description, String color);
    void delete(Long id);
    MediaTag getById(Long id);
    List<MediaTag> getAll();
    List<MediaTag> getPopular(int limit);
    List<MediaTag> search(String keyword);
    void tagFile(Long fileId, Long tagId, Long userId, TagSource source);
    void batchTag(List<Long> fileIds, Long tagId, Long userId);
    void untagFile(Long fileId, Long tagId);
    List<MediaTag> getFileTags(Long fileId);
    List<MediaTag> suggestTags(Long fileId);
    String generateUniqueSlug(String name);
}
