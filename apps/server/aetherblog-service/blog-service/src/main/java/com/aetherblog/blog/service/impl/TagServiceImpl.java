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
        if (tagRepository.existsByName(tag.getName())) {
            throw new BusinessException(400, "标签名已存在");
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
        existing.setName(tag.getName());
        existing.setColor(tag.getColor());
        return tagRepository.save(existing);
    }

    @Override
    @Transactional
    public void deleteTag(Long id) {
        tagRepository.deleteById(id);
    }
}
