package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.dto.request.VanBlogArticlePayload;
import com.aetherblog.blog.dto.request.VanBlogDraftPayload;
import com.aetherblog.blog.dto.request.VanBlogFriendLinkPayload;
import com.aetherblog.blog.dto.response.ImportVanBlogResult;
import com.aetherblog.blog.entity.Category;
import com.aetherblog.blog.entity.FriendLink;
import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.entity.Tag;
import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.FriendLinkRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import com.aetherblog.blog.service.VanBlogImportService;
import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.core.utils.SlugUtils;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.*;

@Service
@Slf4j
@RequiredArgsConstructor
public class VanBlogImportServiceImpl implements VanBlogImportService {

    private static final String MODE_EXECUTE = "execute";

    private final ObjectMapper objectMapper;
    private final PostRepository postRepository;
    private final CategoryRepository categoryRepository;
    private final TagRepository tagRepository;
    private final FriendLinkRepository friendLinkRepository;
    private final EntityManager entityManager;

    @Override
    @Transactional
    public ImportVanBlogResult importBackup(MultipartFile file, String mode) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(400, "导入文件不能为空");
        }

        boolean execute = MODE_EXECUTE.equalsIgnoreCase(mode);
        ImportVanBlogResult result = new ImportVanBlogResult();

        try {
            JsonNode root = objectMapper.readTree(file.getInputStream());
            List<VanBlogArticlePayload> articles = readPayloadList(root, "articles", VanBlogArticlePayload.class);
            List<VanBlogDraftPayload> drafts = readPayloadList(root, "drafts", VanBlogDraftPayload.class);
            List<VanBlogFriendLinkPayload> friendLinks = readPayloadList(root.path("meta"), "links", VanBlogFriendLinkPayload.class);

            result.getSummary().setImportableArticles((int) articles.stream().filter(item -> !Boolean.TRUE.equals(item.deleted())).count());
            result.getSummary().setImportableDrafts((int) drafts.stream().filter(item -> !Boolean.TRUE.equals(item.deleted())).count());
            result.getSummary().setImportableFriendLinks((int) friendLinks.stream().filter(this::isValidFriendLink).count());

            Map<String, Category> categoryMap = prepareCategories(articles, drafts, execute, result);
            Map<String, Tag> tagMap = prepareTags(articles, drafts, execute, result);

            processArticles(articles, categoryMap, tagMap, execute, result);
            processDrafts(drafts, categoryMap, tagMap, execute, result);
            processFriendLinks(friendLinks, execute, result);

            return result;
        } catch (IOException e) {
            log.error("Failed to parse VanBlog backup", e);
            throw new BusinessException(400, "VanBlog 备份文件格式无效");
        }
    }

    private <T> List<T> readPayloadList(JsonNode root, String field, Class<T> clazz) {
        JsonNode node = root.path(field);
        if (!node.isArray()) {
            return List.of();
        }
        List<T> items = new ArrayList<>();
        for (JsonNode item : node) {
            try {
                items.add(objectMapper.treeToValue(item, clazz));
            } catch (Exception e) {
                log.warn("Skip invalid {} item: {}", field, e.getMessage());
            }
        }
        return items;
    }

    private Map<String, Category> prepareCategories(
            List<VanBlogArticlePayload> articles,
            List<VanBlogDraftPayload> drafts,
            boolean execute,
            ImportVanBlogResult result) {
        Set<String> names = new LinkedHashSet<>();
        articles.stream().map(VanBlogArticlePayload::category).filter(this::hasText).forEach(names::add);
        drafts.stream().map(VanBlogDraftPayload::category).filter(this::hasText).forEach(names::add);

        Map<String, Category> map = new HashMap<>();
        for (String name : names) {
            Optional<Category> existing = categoryRepository.findByName(name);
            if (existing.isPresent()) {
                map.put(name, existing.get());
                result.getSummary().setReusedCategories(result.getSummary().getReusedCategories() + 1);
                continue;
            }
            if (!execute) {
                Category stub = new Category();
                stub.setName(name);
                stub.setSlug(buildUniqueCategorySlug(name));
                map.put(name, stub);
                result.getSummary().setCreatedCategories(result.getSummary().getCreatedCategories() + 1);
                continue;
            }
            Category category = new Category();
            category.setName(name);
            category.setSlug(buildUniqueCategorySlug(name));
            category.setSortOrder(0);
            Category saved = categoryRepository.save(category);
            map.put(name, saved);
            result.getSummary().setCreatedCategories(result.getSummary().getCreatedCategories() + 1);
        }
        return map;
    }

    private Map<String, Tag> prepareTags(
            List<VanBlogArticlePayload> articles,
            List<VanBlogDraftPayload> drafts,
            boolean execute,
            ImportVanBlogResult result) {
        Set<String> names = new LinkedHashSet<>();
        articles.stream().flatMap(item -> safeList(item.tags()).stream()).filter(this::hasText).forEach(names::add);
        drafts.stream().flatMap(item -> safeList(item.tags()).stream()).filter(this::hasText).forEach(names::add);

        Map<String, Tag> map = new HashMap<>();
        for (String name : names) {
            Optional<Tag> existing = tagRepository.findByName(name);
            if (existing.isPresent()) {
                map.put(name, existing.get());
                result.getSummary().setReusedTags(result.getSummary().getReusedTags() + 1);
                continue;
            }
            if (!execute) {
                Tag stub = new Tag();
                stub.setName(name);
                stub.setSlug(buildUniqueTagSlug(name));
                map.put(name, stub);
                result.getSummary().setCreatedTags(result.getSummary().getCreatedTags() + 1);
                continue;
            }
            Tag tag = new Tag();
            tag.setName(name);
            tag.setSlug(buildUniqueTagSlug(name));
            Tag saved = tagRepository.save(tag);
            map.put(name, saved);
            result.getSummary().setCreatedTags(result.getSummary().getCreatedTags() + 1);
        }
        return map;
    }

    private void processArticles(
            List<VanBlogArticlePayload> articles,
            Map<String, Category> categoryMap,
            Map<String, Tag> tagMap,
            boolean execute,
            ImportVanBlogResult result) {
        for (VanBlogArticlePayload article : articles) {
            if (Boolean.TRUE.equals(article.deleted())) {
                result.getSummary().setSkippedRecords(result.getSummary().getSkippedRecords() + 1);
                continue;
            }
            if (!hasText(article.title())) {
                result.getWarnings().add("跳过空标题文章 article:" + article.id());
                result.getSummary().setInvalidRecords(result.getSummary().getInvalidRecords() + 1);
                continue;
            }
            String sourceKey = "vanblog:article:" + article.id();
            String slug = resolveImportSlug(article.pathname(), article.title(), article.id(), sourceKey, result);
            ImportVanBlogResult.ItemResult item = new ImportVanBlogResult.ItemResult();
            item.setSourceKey(sourceKey);
            item.setType("article");

            if (!execute) {
                item.setAction(postRepository.findBySourceKey(sourceKey).isPresent() ? "would-update" : "would-create");
                result.getItems().add(item);
                continue;
            }

            Post post = postRepository.findBySourceKey(sourceKey).orElseGet(Post::new);
            boolean existing = post.getId() != null;
            hydrateCommonFields(
                    post,
                    article.title(),
                    defaultString(article.content()),
                    generateSummary(article.content()),
                    slug,
                    Post.PostStatus.PUBLISHED,
                    categoryMap.get(article.category()),
                    resolveTags(article.tags(), tagMap),
                    article.top(),
                    article.hidden(),
                    article.password(),
                    sourceKey,
                    article.author(),
                    article.visited(),
                    article.copyright()
            );
            Post saved = postRepository.saveAndFlush(post);
            applyImportMetadata(
                    saved.getId(),
                    article.createdAt(),
                    article.updatedAt(),
                    article.createdAt(),
                    article.viewer(),
                    article.hidden(),
                    article.author(),
                    article.visited(),
                    article.copyright(),
                    sourceKey
            );
            entityManager.flush();
            entityManager.clear();
            item.setPostId(saved.getId());
            item.setAction(existing ? "updated" : "created");
            result.getItems().add(item);
            if (existing) {
                result.getSummary().setUpdatedPosts(result.getSummary().getUpdatedPosts() + 1);
            } else {
                result.getSummary().setCreatedPosts(result.getSummary().getCreatedPosts() + 1);
            }
        }
    }

    private void processDrafts(
            List<VanBlogDraftPayload> drafts,
            Map<String, Category> categoryMap,
            Map<String, Tag> tagMap,
            boolean execute,
            ImportVanBlogResult result) {
        for (VanBlogDraftPayload draft : drafts) {
            if (Boolean.TRUE.equals(draft.deleted())) {
                result.getSummary().setSkippedRecords(result.getSummary().getSkippedRecords() + 1);
                continue;
            }
            if (!hasText(draft.title())) {
                result.getWarnings().add("跳过空标题草稿 draft:" + draft.id());
                result.getSummary().setInvalidRecords(result.getSummary().getInvalidRecords() + 1);
                continue;
            }
            String sourceKey = "vanblog:draft:" + draft.id();
            String slug = resolveImportSlug(null, draft.title(), draft.id(), sourceKey, result);
            ImportVanBlogResult.ItemResult item = new ImportVanBlogResult.ItemResult();
            item.setSourceKey(sourceKey);
            item.setType("draft");

            if (!execute) {
                item.setAction(postRepository.findBySourceKey(sourceKey).isPresent() ? "would-update" : "would-create");
                result.getItems().add(item);
                continue;
            }

            Post post = postRepository.findBySourceKey(sourceKey).orElseGet(Post::new);
            boolean existing = post.getId() != null;
            hydrateCommonFields(
                    post,
                    draft.title(),
                    defaultString(draft.content()),
                    generateSummary(draft.content()),
                    slug,
                    Post.PostStatus.DRAFT,
                    categoryMap.get(draft.category()),
                    resolveTags(draft.tags(), tagMap),
                    0,
                    false,
                    null,
                    sourceKey,
                    draft.author(),
                    0L,
                    null
            );
            Post saved = postRepository.saveAndFlush(post);
            applyImportMetadata(
                    saved.getId(),
                    draft.createdAt(),
                    draft.updatedAt(),
                    null,
                    saved.getViewCount(),
                    false,
                    draft.author(),
                    0L,
                    null,
                    sourceKey
            );
            entityManager.flush();
            entityManager.clear();
            item.setPostId(saved.getId());
            item.setAction(existing ? "updated" : "created");
            result.getItems().add(item);
            if (existing) {
                result.getSummary().setUpdatedPosts(result.getSummary().getUpdatedPosts() + 1);
            } else {
                result.getSummary().setCreatedPosts(result.getSummary().getCreatedPosts() + 1);
            }
        }
    }

    private void processFriendLinks(
            List<VanBlogFriendLinkPayload> friendLinks,
            boolean execute,
            ImportVanBlogResult result
    ) {
        int sortOrder = 0;
        for (VanBlogFriendLinkPayload friendLink : friendLinks) {
            if (!isValidFriendLink(friendLink)) {
                result.getWarnings().add("跳过非法友情链接: " + (friendLink != null ? friendLink.url() : "null"));
                result.getSummary().setInvalidRecords(result.getSummary().getInvalidRecords() + 1);
                continue;
            }

            String sourceKey = "vanblog:friend-link:" + friendLink.url().trim();
            ImportVanBlogResult.ItemResult item = new ImportVanBlogResult.ItemResult();
            item.setSourceKey(sourceKey);
            item.setType("friend-link");

            Optional<FriendLink> existingLink = friendLinkRepository.findByUrl(friendLink.url().trim());
            if (!execute) {
                item.setAction(existingLink.isPresent() ? "would-update" : "would-create");
                item.setRecordId(existingLink.map(FriendLink::getId).orElse(null));
                result.getItems().add(item);
                sortOrder++;
                continue;
            }

            FriendLink entity = existingLink.orElseGet(FriendLink::new);
            boolean existing = entity.getId() != null;
            entity.setName(friendLink.name().trim());
            entity.setUrl(friendLink.url().trim());
            entity.setDescription(hasText(friendLink.desc()) ? friendLink.desc().trim() : null);
            entity.setLogo(hasText(friendLink.logo()) ? friendLink.logo().trim() : null);
            entity.setVisible(true);
            entity.setSortOrder(sortOrder);

            FriendLink saved = friendLinkRepository.saveAndFlush(entity);
            LocalDateTime preservedTime = friendLink.updatedAt() != null ? friendLink.updatedAt() : LocalDateTime.now();
            friendLinkRepository.applyImportMetadata(saved.getId(), preservedTime, preservedTime);
            entityManager.flush();
            entityManager.clear();

            item.setRecordId(saved.getId());
            item.setAction(existing ? "updated" : "created");
            result.getItems().add(item);
            if (existing) {
                result.getSummary().setUpdatedFriendLinks(result.getSummary().getUpdatedFriendLinks() + 1);
            } else {
                result.getSummary().setCreatedFriendLinks(result.getSummary().getCreatedFriendLinks() + 1);
            }
            sortOrder++;
        }
    }

    private void hydrateCommonFields(
            Post post,
            String title,
            String content,
            String summary,
            String slug,
            Post.PostStatus status,
            Category category,
            Set<Tag> tags,
            Integer top,
            Boolean hidden,
            String password,
            String sourceKey,
            String legacyAuthorName,
            Long legacyVisitedCount,
            String legacyCopyright
    ) {
        post.setTitle(title);
        post.setContentMarkdown(content);
        post.setSummary(summary);
        post.setSlug(slug);
        post.setStatus(status);
        post.setCategory(category);
        post.setTags(tags);
        post.setPinPriority(top != null ? Math.max(top, 0) : 0);
        post.setIsPinned(top != null && top > 0);
        post.setIsHidden(Boolean.TRUE.equals(hidden));
        post.setPassword(hasText(password) ? password : null);
        post.setSourceKey(sourceKey);
        post.setLegacyAuthorName(hasText(legacyAuthorName) ? legacyAuthorName : null);
        post.setLegacyVisitedCount(legacyVisitedCount != null ? legacyVisitedCount : 0L);
        post.setLegacyCopyright(hasText(legacyCopyright) ? legacyCopyright : null);
        post.setWordCount(calculateWordCount(content));
    }

    private void applyImportMetadata(
            Long id,
            LocalDateTime createdAt,
            LocalDateTime updatedAt,
            LocalDateTime publishedAt,
            Long viewCount,
            Boolean isHidden,
            String legacyAuthorName,
            Long legacyVisitedCount,
            String legacyCopyright,
            String sourceKey
    ) {
        LocalDateTime safeCreatedAt = createdAt != null ? createdAt : LocalDateTime.now();
        LocalDateTime safeUpdatedAt = updatedAt != null ? updatedAt : safeCreatedAt;
        postRepository.applyImportMetadata(
                id,
                safeCreatedAt,
                safeUpdatedAt,
                publishedAt,
                viewCount != null ? viewCount : 0L,
                Boolean.TRUE.equals(isHidden),
                hasText(legacyAuthorName) ? legacyAuthorName : null,
                legacyVisitedCount != null ? legacyVisitedCount : 0L,
                hasText(legacyCopyright) ? legacyCopyright : null,
                sourceKey
        );
    }

    private Set<Tag> resolveTags(List<String> tags, Map<String, Tag> tagMap) {
        Set<Tag> resolved = new LinkedHashSet<>();
        for (String tagName : safeList(tags)) {
            Tag tag = tagMap.get(tagName);
            if (tag != null) {
                resolved.add(tag);
            }
        }
        return resolved;
    }

    private String resolveImportSlug(String pathname, String title, Integer sourceId, String sourceKey, ImportVanBlogResult result) {
        String raw = hasText(pathname) ? pathname.trim() : SlugUtils.toSlug(title);
        if (!hasText(raw)) {
            raw = "vanblog-" + sourceId;
        }
        Optional<Post> existing = postRepository.findBySourceKey(sourceKey);
        if (existing.isPresent()) {
            return existing.get().getSlug();
        }
        String slug = raw;
        int suffix = 1;
        while (postRepository.existsBySlug(slug)) {
            result.getSummary().setSlugConflicts(result.getSummary().getSlugConflicts() + 1);
            slug = raw + "-vanblog-" + sourceId + (suffix > 1 ? "-" + suffix : "");
            suffix++;
        }
        return slug;
    }

    private String buildUniqueCategorySlug(String name) {
        String base = hasText(SlugUtils.toSlug(name)) ? SlugUtils.toSlug(name) : "vanblog-category";
        String slug = base;
        int count = 1;
        while (categoryRepository.findBySlug(slug).isPresent()) {
            slug = base + "-vanblog-" + count++;
        }
        return slug;
    }

    private String buildUniqueTagSlug(String name) {
        String base = hasText(SlugUtils.toSlug(name)) ? SlugUtils.toSlug(name) : "vanblog-tag";
        String slug = base;
        int count = 1;
        while (tagRepository.findBySlug(slug).isPresent()) {
            slug = base + "-vanblog-" + count++;
        }
        return slug;
    }

    private String generateSummary(String markdown) {
        if (!hasText(markdown)) {
            return null;
        }
        String[] moreSplit = markdown.split("<!--\\s*more\\s*-->", 2);
        String source = moreSplit.length > 1 ? moreSplit[0] : markdown;
        String plain = source
                .replaceAll("```[\\s\\S]*?```", " ")
                .replaceAll("`[^`]*`", " ")
                .replaceAll("!?\\[[^\\]]*\\]\\([^)]*\\)", " ")
                .replaceAll("<[^>]+>", " ")
                .replaceAll("[#>*_~\\-]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
        if (plain.isEmpty()) {
            return null;
        }
        return plain.length() <= 200 ? plain : plain.substring(0, 200);
    }

    private int calculateWordCount(String content) {
        if (!hasText(content)) {
            return 0;
        }
        return content
                .replaceAll("```[\\s\\S]*?```", "")
                .replaceAll("`[^`]*`", "")
                .replaceAll("!?\\[[^\\]]*\\]\\([^)]*\\)", "")
                .replaceAll("#+\\s*", "")
                .replaceAll("[*_~`>|-]+", "")
                .replaceAll("\\s+", "")
                .length();
    }

    private boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private boolean isValidFriendLink(VanBlogFriendLinkPayload friendLink) {
        return friendLink != null && hasText(friendLink.name()) && hasText(friendLink.url());
    }

    private String defaultString(String value) {
        return value != null ? value : "";
    }

    private List<String> safeList(List<String> values) {
        return values != null ? values : List.of();
    }
}
