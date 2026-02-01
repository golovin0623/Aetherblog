package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.*;
import com.aetherblog.blog.entity.MediaFileTag.TagSource;
import com.aetherblog.blog.repository.*;
import com.aetherblog.blog.service.MediaTagService;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;

@Slf4j
@Service
@RequiredArgsConstructor
public class MediaTagServiceImpl implements MediaTagService {

    private final MediaTagRepository tagRepository;
    private final MediaFileTagRepository fileTagRepository;
    private final MediaFileRepository fileRepository;
    private final UserRepository userRepository;

    private static final Pattern NON_LATIN = Pattern.compile("[^\\w-]");
    private static final Pattern WHITESPACE = Pattern.compile("[\\s]");

    @Override
    @Transactional
    public MediaTag create(String name, String description, String color) {
        Objects.requireNonNull(name, "标签名称不能为空");

        if (tagRepository.existsByName(name)) {
            throw new BusinessException(400, "标签名称已存在: " + name);
        }

        String slug = generateUniqueSlug(name);

        MediaTag tag = new MediaTag();
        tag.setName(name.trim());
        tag.setSlug(slug);
        tag.setDescription(description);
        tag.setColor(StringUtils.hasText(color) ? color : "#6366f1");
        tag.setCategory(MediaTag.TagCategory.CUSTOM);

        MediaTag saved = tagRepository.save(tag);
        log.info("创建标签成功: id={}, name={}", saved.getId(), saved.getName());

        return saved;
    }

    @Override
    @Transactional
    public MediaTag update(Long id, String name, String description, String color) {
        MediaTag tag = getById(id);

        if (StringUtils.hasText(name) && !name.equals(tag.getName())) {
            if (tagRepository.existsByName(name)) {
                throw new BusinessException(400, "标签名称已存在: " + name);
            }
            tag.setName(name.trim());
            tag.setSlug(generateUniqueSlug(name));
        }

        if (description != null) {
            tag.setDescription(description);
        }

        if (StringUtils.hasText(color)) {
            tag.setColor(color);
        }

        return tagRepository.save(tag);
    }

    @Override
    @Transactional
    public void delete(Long id) {
        MediaTag tag = getById(id);

        if (tag.getCategory() == MediaTag.TagCategory.SYSTEM) {
            throw new BusinessException(400, "不能删除系统标签");
        }

        tagRepository.delete(tag);
        log.info("删除标签成功: id={}, name={}", id, tag.getName());
    }

    @Override
    public MediaTag getById(Long id) {
        return tagRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "标签不存在: " + id));
    }

    @Override
    public List<MediaTag> getAll() {
        return tagRepository.findAll();
    }

    @Override
    public List<MediaTag> getPopular(int limit) {
        return tagRepository.findTop20ByOrderByUsageCountDesc()
                .stream()
                .limit(limit)
                .toList();
    }

    @Override
    public List<MediaTag> search(String keyword) {
        if (!StringUtils.hasText(keyword)) {
            return getAll();
        }
        return tagRepository.searchByKeyword(keyword);
    }

    @Override
    @Transactional
    public void tagFile(Long fileId, Long tagId, Long userId, TagSource source) {
        MediaFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new BusinessException(404, "文件不存在: " + fileId));
        MediaTag tag = getById(tagId);

        if (fileTagRepository.existsByMediaFileIdAndTagId(fileId, tagId)) {
            return;
        }

        MediaFileTag fileTag = new MediaFileTag();
        MediaFileTag.MediaFileTagId id = new MediaFileTag.MediaFileTagId();
        id.setMediaFileId(fileId);
        id.setTagId(tagId);
        fileTag.setId(id);
        fileTag.setMediaFile(file);
        fileTag.setTag(tag);
        fileTag.setSource(source != null ? source : TagSource.MANUAL);

        if (userId != null) {
            userRepository.findById(userId).ifPresent(fileTag::setTaggedBy);
        }

        fileTagRepository.save(fileTag);
        tagRepository.incrementUsageCount(tagId);

        log.info("文件打标签成功: fileId={}, tagId={}", fileId, tagId);
    }

    @Override
    @Transactional
    public void batchTag(List<Long> fileIds, Long tagId, Long userId) {
        for (Long fileId : fileIds) {
            try {
                tagFile(fileId, tagId, userId, TagSource.MANUAL);
            } catch (Exception e) {
                log.warn("批量打标签失败: fileId={}, error={}", fileId, e.getMessage());
            }
        }
    }

    @Override
    @Transactional
    public void untagFile(Long fileId, Long tagId) {
        fileTagRepository.deleteByMediaFileIdAndTagId(fileId, tagId);
        tagRepository.decrementUsageCount(tagId);
        log.info("取消文件标签成功: fileId={}, tagId={}", fileId, tagId);
    }

    @Override
    public List<MediaTag> getFileTags(Long fileId) {
        return fileTagRepository.findTagsByFileId(fileId);
    }

    @Override
    public List<MediaTag> suggestTags(Long fileId) {
        // TODO: 集成AI服务进行标签建议 (Phase 2可选功能)
        return Collections.emptyList();
    }

    @Override
    public String generateUniqueSlug(String name) {
        String baseSlug = slugify(name);
        String slug = baseSlug;
        int counter = 1;

        while (tagRepository.existsBySlug(slug)) {
            slug = baseSlug + "-" + counter;
            counter++;
        }

        return slug;
    }

    private String slugify(String input) {
        if (input == null || input.isEmpty()) {
            return "tag";
        }

        String noWhitespace = WHITESPACE.matcher(input).replaceAll("-");
        String normalized = Normalizer.normalize(noWhitespace, Normalizer.Form.NFD);
        String slug = NON_LATIN.matcher(normalized).replaceAll("");
        slug = slug.toLowerCase(Locale.ENGLISH);
        slug = slug.replaceAll("-+", "-");
        slug = slug.replaceAll("^-|-$", "");

        return slug.isEmpty() ? "tag" : slug;
    }
}
