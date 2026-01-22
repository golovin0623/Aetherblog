package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.dto.request.CreatePostRequest;
import com.aetherblog.blog.dto.request.UpdatePostPropertiesRequest;
import com.aetherblog.blog.dto.response.PostDetailResponse;
import com.aetherblog.blog.dto.response.PostListResponse;
import com.aetherblog.blog.entity.Category;
import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.entity.Post.PostStatus;
import com.aetherblog.blog.entity.Tag;
import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import com.aetherblog.blog.service.PostService;
import com.aetherblog.common.core.domain.PageResult;
import com.aetherblog.common.core.exception.BusinessException;
import com.aetherblog.common.core.utils.SlugUtils;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.criteria.Predicate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * 文章服务实现类
 *
 * @author AI Assistant
 * @since 1.0.0
 * @see §4.3 - 业务服务实现
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
@SuppressWarnings("null")
public class PostServiceImpl implements PostService {

    private final PostRepository postRepository;
    private final CategoryRepository categoryRepository;
    private final TagRepository tagRepository;
    private final StringRedisTemplate stringRedisTemplate;
    private final ObjectMapper objectMapper;

    private static final String DRAFT_KEY_PREFIX = "post:draft:";

    @Override
    public List<Post> getAllPublishedPosts() {
        return postRepository.findAllByStatusOrderByPublishedAtDesc(PostStatus.PUBLISHED);
    }

    @Override
    public PageResult<PostListResponse> getPublishedPosts(int pageNum, int pageSize) {
        Page<Post> page = postRepository.findPublished(PageRequest.of(pageNum - 1, pageSize));
        return toPageResult(page, pageNum, pageSize);
    }

    @Override
    public PageResult<PostListResponse> getPostsForAdmin(
            String status, 
            String keyword, 
            Long categoryId,
            Long tagId,
            Integer minViewCount,
            Integer maxViewCount,
            LocalDateTime startDate,
            LocalDateTime endDate,
            int pageNum, 
            int pageSize) {
        
        Specification<Post> spec = buildAdminSpecification(status, keyword, categoryId, tagId, minViewCount, maxViewCount, startDate, endDate);
        
        PageRequest pageRequest = PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Post> page = postRepository.findAll(spec, pageRequest);
        
        return toPageResult(page, pageNum, pageSize);
    }

    private Specification<Post> buildAdminSpecification(
            String status, 
            String keyword, 
            Long categoryId,
            Long tagId,
            Integer minViewCount,
            Integer maxViewCount,
            LocalDateTime startDate,
            LocalDateTime endDate) {
        
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();

            // 1. 状态筛选
            if (status != null && !status.trim().isEmpty()) {
                try {
                    predicates.add(cb.equal(root.get("status"), PostStatus.valueOf(status.toUpperCase())));
                } catch (IllegalArgumentException e) {
                    log.warn("Invalid post status: {}", status);
                }
            }

            // 2. 关键词搜索 (匹配标题和内容)
            if (keyword != null && !keyword.trim().isEmpty()) {
                String pattern = "%" + keyword.trim().toLowerCase() + "%";
                predicates.add(cb.or(
                    cb.like(cb.lower(root.get("title")), pattern),
                    cb.like(cb.lower(root.get("contentMarkdown")), pattern)
                ));
            }

            // 3. 分类筛选
            if (categoryId != null) {
                predicates.add(cb.equal(root.get("category").get("id"), categoryId));
            }

            // 4. 标签筛选
            if (tagId != null) {
                query.distinct(true); 
                predicates.add(cb.equal(root.join("tags").get("id"), tagId));
            }

            // 5. 浏览量范围
            if (minViewCount != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("viewCount"), minViewCount));
            }
            if (maxViewCount != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("viewCount"), maxViewCount));
            }

            // 6. 发布时间范围
            if (startDate != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), startDate));
            }
            if (endDate != null) {
                predicates.add(cb.lessThanOrEqualTo(root.get("createdAt"), endDate));
            }

            return cb.and(predicates.toArray(new Predicate[0]));
        };
    }

    @Override
    public PageResult<PostListResponse> getPostsByCategory(Long categoryId, int pageNum, int pageSize) {
        Page<Post> page = postRepository.findByCategoryId(categoryId, PageRequest.of(pageNum - 1, pageSize));
        return toPageResult(page, pageNum, pageSize);
    }

    @Override
    public PageResult<PostListResponse> getPostsByTag(Long tagId, int pageNum, int pageSize) {
        Page<Post> page = postRepository.findByTagId(tagId, PageRequest.of(pageNum - 1, pageSize));
        return toPageResult(page, pageNum, pageSize);
    }

    @Override
    public PostDetailResponse getPostById(Long id) {
        Post post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文章不存在"));
        
        PostDetailResponse response = toDetailResponse(post);
        
        // 尝试加载Redis缓存中的草稿
        String draftKey = DRAFT_KEY_PREFIX + id;
        try {
            String draftJson = stringRedisTemplate.opsForValue().get(draftKey);
            if (draftJson != null) {
                CreatePostRequest draft = objectMapper.readValue(draftJson, CreatePostRequest.class);
                response.setDraft(draft);
            }
        } catch (Exception e) {
            log.error("Failed to load draft from Redis for post {}", id, e);
        }

        return response;
    }

    @Override
    public PostDetailResponse getPostBySlug(String slug) {
        log.info("Fetching post by slug: {}", slug);
        Post post = postRepository.findBySlug(slug)
                .orElseThrow(() -> {
                    log.error("Post not found for slug: {}", slug);
                    return new BusinessException(404, "文章不存在");
                });
        try {
            // 前台访问通常不需要草稿，只有后台编辑(ID访问)才需要。但为了保持一致性暂不加载草稿，或视需求而定。
            // 这里遵循原逻辑只返回正式内容
            return toDetailResponse(post);
        } catch (Exception e) {
            log.error("Error converting post to detail response: {}", e.getMessage(), e);
            throw new BusinessException(500, "文章数据解析异常");
        }
    }

    @Override
    @Transactional
    public PostDetailResponse createPost(CreatePostRequest request) {
        Post post = new Post();
        post.setTitle(request.title());
        post.setContentMarkdown(request.content());
        post.setSummary(request.summary());
        post.setCoverImage(request.coverImage());
        post.setSlug(generateUniqueSlug(request.title()));
        post.setStatus(PostStatus.valueOf(request.status()));
        post.setWordCount(calculateWordCount(request.content()));
        if (post.getStatus() == PostStatus.PUBLISHED) {
            post.setPublishedAt(LocalDateTime.now());
        }

        if (request.categoryId() != null) {
            Category category = categoryRepository.findById(request.categoryId())
                    .orElseThrow(() -> new BusinessException(404, "分类不存在"));
            post.setCategory(category);
        }

        if (request.tagIds() != null && !request.tagIds().isEmpty()) {
            Set<Tag> tags = new HashSet<>(tagRepository.findAllById(request.tagIds()));
            post.setTags(tags);
        }

        return toDetailResponse(postRepository.save(post));
    }

    @Override
    @Transactional
    public PostDetailResponse updatePost(Long id, CreatePostRequest request) {
        Post post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文章不存在"));

        post.setTitle(request.title());
        post.setContentMarkdown(request.content());
        post.setSummary(request.summary());
        post.setCoverImage(request.coverImage());
        post.setWordCount(calculateWordCount(request.content()));

        // 更新状态，如果是发布操作则设置发布时间
        if (request.status() != null) {
            PostStatus newStatus = PostStatus.valueOf(request.status());
            if (newStatus == PostStatus.PUBLISHED && post.getPublishedAt() == null) {
                post.setPublishedAt(LocalDateTime.now());
            }
            post.setStatus(newStatus);
            
            // 如果是发布操作，清除草稿
            if (newStatus == PostStatus.PUBLISHED) {
                stringRedisTemplate.delete(DRAFT_KEY_PREFIX + id);
            }
        }

        if (request.categoryId() != null) {
            Category category = categoryRepository.findById(request.categoryId())
                    .orElseThrow(() -> new BusinessException(404, "分类不存在"));
            post.setCategory(category);
        }

        if (request.tagIds() != null) {
            Set<Tag> tags = new HashSet<>(tagRepository.findAllById(request.tagIds()));
            post.setTags(tags);
        }

        return toDetailResponse(postRepository.save(post));
    }

    @Override
    @Transactional
    public PostDetailResponse updatePostProperties(Long id, UpdatePostPropertiesRequest request) {
        Post post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文章不存在"));

        // 更新标题
        if (request.title() != null) {
            post.setTitle(request.title());
        }

        // 更新摘要
        if (request.summary() != null) {
            post.setSummary(request.summary());
        }

        // 更新封面图
        if (request.coverImage() != null) {
            post.setCoverImage(request.coverImage());
        }

        // 更新分类
        if (request.categoryId() != null) {
            Category category = categoryRepository.findById(request.categoryId())
                    .orElseThrow(() -> new BusinessException(404, "分类不存在"));
            post.setCategory(category);
        }

        // 更新标签
        if (request.tagIds() != null) {
            Set<Tag> tags = new HashSet<>(tagRepository.findAllById(request.tagIds()));
            post.setTags(tags);
        }

        // 更新状态
        if (request.status() != null) {
            PostStatus newStatus = PostStatus.valueOf(request.status());
            if (newStatus == PostStatus.PUBLISHED && post.getPublishedAt() == null) {
                post.setPublishedAt(LocalDateTime.now());
            }
            post.setStatus(newStatus);
        }

        // 更新置顶状态
        if (request.isPinned() != null) {
            post.setIsPinned(request.isPinned());
        }

        // 更新置顶优先级
        if (request.pinPriority() != null) {
            post.setPinPriority(request.pinPriority());
        }

        // 更新是否允许评论
        if (request.allowComment() != null) {
            post.setAllowComment(request.allowComment());
        }

        // 更新文章密码
        if (request.password() != null) {
            post.setPassword(request.password());
        }

        // 更新自定义路径名
        if (request.slug() != null && !request.slug().isEmpty()) {
            // 检查slug是否已存在（排除当前文章）
            if (postRepository.existsBySlugAndIdNot(request.slug(), id)) {
                throw new BusinessException(400, "该路径名已被使用");
            }
            post.setSlug(request.slug());
        }

        // 更新创建时间
        if (request.createdAt() != null) {
            post.setCreatedAt(request.createdAt());
        }

        return toDetailResponse(postRepository.save(post));
    }

    @Override
    @Transactional
    public void saveDraft(Long id, CreatePostRequest request) {
        // 检查文章是否存在
        if (!postRepository.existsById(id)) {
            throw new BusinessException(404, "文章不存在");
        }
        
        String draftKey = DRAFT_KEY_PREFIX + id;
        try {
            String json = objectMapper.writeValueAsString(request);
            stringRedisTemplate.opsForValue().set(draftKey, json, 7, TimeUnit.DAYS);
        } catch (Exception e) {
            log.error("Error saving draft for post {}", id, e);
            throw new BusinessException(500, "保存草稿失败");
        }
    }

    @Override
    @Transactional
    public void deletePost(Long id) {
        if (!postRepository.existsById(id)) {
            throw new BusinessException(404, "文章不存在");
        }
        postRepository.deleteById(id);
        // 删除文章时同时清除草稿
        stringRedisTemplate.delete(DRAFT_KEY_PREFIX + id);
    }

    @Override
    @Transactional
    public void publishPost(Long id) {
        Post post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文章不存在"));
        post.setStatus(PostStatus.PUBLISHED);
        if (post.getPublishedAt() == null) {
            post.setPublishedAt(LocalDateTime.now());
        }
        postRepository.save(post);
        
        // 发布后清除草稿
        stringRedisTemplate.delete(DRAFT_KEY_PREFIX + id);
    }

    @Override
    @Transactional
    public void incrementViewCount(Long id) {
        postRepository.findById(id).ifPresent(post -> {
            post.setViewCount(post.getViewCount() + 1);
            postRepository.save(post);
        });
    }

    private String generateUniqueSlug(String title) {
        String baseSlug = SlugUtils.toSlug(title);
        if (baseSlug.isEmpty()) {
            baseSlug = "post";
        }
        String slug = baseSlug;
        int count = 1;
        while (postRepository.existsBySlug(slug)) {
            slug = baseSlug + "-" + count++;
        }
        return slug;
    }

    /**
     * 计算文章字数
     * 移除 Markdown 标记后统计字符数
     */
    private int calculateWordCount(String content) {
        if (content == null || content.isBlank()) {
            return 0;
        }
        // 移除 Markdown 标记
        String text = content
                .replaceAll("```[\\s\\S]*?```", "")  // 代码块
                .replaceAll("`[^`]*`", "")           // 行内代码
                .replaceAll("!?\\[[^\\]]*\\]\\([^)]*\\)", "")  // 链接/图片
                .replaceAll("#+\\s*", "")            // 标题#
                .replaceAll("[*_~`>|-]+", "")        // 格式符号
                .replaceAll("\\s+", "");             // 空白
        return text.length();
    }

    private PageResult<PostListResponse> toPageResult(Page<Post> page, int pageNum, int pageSize) {
        List<PostListResponse> list = page.getContent().stream()
                .map(this::toListResponse)
                .collect(Collectors.toList());
        return PageResult.of(list, page.getTotalElements(), pageNum, pageSize);
    }

    private PostListResponse toListResponse(Post post) {
        PostListResponse response = new PostListResponse();
        response.setId(post.getId());
        response.setTitle(post.getTitle());
        response.setSlug(post.getSlug());
        response.setSummary(post.getSummary());
        response.setCoverImage(addApiPrefixToImageUrl(post.getCoverImage()));
        response.setStatus(post.getStatus().name());
        response.setCategoryName(post.getCategory() != null ? post.getCategory().getName() : null);
        response.setTagNames(post.getTags().stream().map(Tag::getName).collect(Collectors.toList()));
        response.setViewCount(post.getViewCount());
        response.setCommentCount(post.getCommentCount());
        response.setPublishedAt(post.getPublishedAt());
        return response;
    }

    private PostDetailResponse toDetailResponse(Post post) {
        PostDetailResponse response = new PostDetailResponse();
        response.setId(post.getId());
        response.setTitle(post.getTitle());
        response.setSlug(post.getSlug());
        response.setContent(post.getContentMarkdown());
        response.setSummary(post.getSummary());
        response.setCoverImage(addApiPrefixToImageUrl(post.getCoverImage()));
        response.setStatus(post.getStatus().name());
        response.setViewCount(post.getViewCount());
        response.setCommentCount(post.getCommentCount());
        response.setLikeCount(post.getLikeCount());
        response.setPublishedAt(post.getPublishedAt());
        response.setCreatedAt(post.getCreatedAt());
        response.setUpdatedAt(post.getUpdatedAt());

        if (post.getCategory() != null) {
            PostDetailResponse.CategoryInfo categoryInfo = new PostDetailResponse.CategoryInfo();
            categoryInfo.setId(post.getCategory().getId());
            categoryInfo.setName(post.getCategory().getName());
            categoryInfo.setSlug(post.getCategory().getSlug());
            response.setCategory(categoryInfo);
        }

        if (post.getTags() != null) {
            response.setTags(post.getTags().stream().map(tag -> {
                PostDetailResponse.TagInfo tagInfo = new PostDetailResponse.TagInfo();
                tagInfo.setId(tag.getId());
                tagInfo.setName(tag.getName());
                tagInfo.setSlug(tag.getSlug());
                tagInfo.setColor(tag.getColor());
                return tagInfo;
            }).collect(Collectors.toList()));
        } else {
            response.setTags(List.of());
        }

        return response;
    }

    /**
     * 为以 /uploads 开头的图片 URL 添加 /api 前缀
     * 这处理了 Spring Boot 中的 context-path 配置
     */
    private String addApiPrefixToImageUrl(String imageUrl) {
        if (imageUrl != null && imageUrl.startsWith("/uploads")) {
            return "/api" + imageUrl;
        }
        return imageUrl;
    }
}
