package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.Tag;
import com.aetherblog.blog.repository.TagRepository;
import com.aetherblog.blog.service.TagService;
import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.core.utils.SlugUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 标签服务实现
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class TagServiceImpl implements TagService {

    private final TagRepository tagRepository;

    @Override
    public List<Tag> getAllTags() {
        return tagRepository.findAll();
    }

    @Override
    public Tag getTagById(Long id) {
        return tagRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "标签不存在"));
    }

    @Override
    public Tag getTagBySlug(String slug) {
        return tagRepository.findBySlug(slug)
                .orElseThrow(() -> new BusinessException(404, "标签不存在"));
    }

    @Override
    @Transactional
    public Tag createTag(Tag tag) {
        // 校验标签名称不能重复
        if (tagRepository.existsByName(tag.getName())) {
            throw new BusinessException(400, "标签名称已存在");
        }
        if (tag.getSlug() == null || tag.getSlug().isEmpty()) {
            tag.setSlug(SlugUtils.toSlug(tag.getName()));
        }
        return tagRepository.save(tag);
    }

    @Override
    @Transactional
    public Tag updateTag(Long id, Tag tag) {
        Tag existing = getTagById(id);
        // 如果名称变更，校验新名称是否已被使用
        if (!existing.getName().equals(tag.getName()) 
                && tagRepository.existsByName(tag.getName())) {
            throw new BusinessException(400, "标签名称已存在");
        }
        existing.setName(tag.getName());
        existing.setColor(tag.getColor());
        existing.setDescription(tag.getDescription());
        return tagRepository.save(existing);
    }

    @Override
    @Transactional
    public void deleteTag(Long id) {
        tagRepository.deleteById(id);
    }

    @Override
    @Transactional
    public Tag getOrCreateTag(String name) {
        return tagRepository.findByName(name)
                .orElseGet(() -> {
                    Tag newTag = new Tag();
                    newTag.setName(name);
                    newTag.setSlug(SlugUtils.toSlug(name));
                    return tagRepository.save(newTag);
                });
    }
}
