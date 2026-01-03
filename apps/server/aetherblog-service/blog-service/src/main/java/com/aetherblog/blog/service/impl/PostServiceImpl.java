package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.dto.request.CreatePostRequest;
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
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 文章服务实现
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
    public PageResult<PostListResponse> getPostsForAdmin(String status, String keyword, int pageNum, int pageSize) {
        Page<Post> page;
        PageRequest pageRequest = PageRequest.of(pageNum - 1, pageSize, Sort.by(Sort.Direction.DESC, "createdAt"));
        
        boolean hasStatus = status != null && !status.isEmpty();
        boolean hasKeyword = keyword != null && !keyword.trim().isEmpty();
        
        if (!hasStatus && !hasKeyword) {
            // 无筛选条件，返回所有
            page = postRepository.findAllOrderByCreatedAtDesc(pageRequest);
        } else if (hasStatus && !hasKeyword) {
            // 仅状态筛选
            if (status != null) {
                 PostStatus postStatus = PostStatus.valueOf(status.toUpperCase());
                 page = postRepository.findByStatus(postStatus, pageRequest);
            } else {
                 page = postRepository.findAllOrderByCreatedAtDesc(pageRequest);
            }
        } else if (!hasStatus && hasKeyword) {
            // 仅关键词搜索
            String searchKey = keyword == null ? "" : keyword.trim();
            page = postRepository.findByKeyword(searchKey, pageRequest);
        } else {
            // 状态 + 关键词
            String searchKey = keyword == null ? "" : keyword.trim();
             if (status != null) {
                PostStatus postStatus = PostStatus.valueOf(status.toUpperCase());
                page = postRepository.findByStatusAndKeyword(postStatus, searchKey, pageRequest);
             } else {
                 page = postRepository.findByKeyword(searchKey, pageRequest);
             }
        }
        
        return toPageResult(page, pageNum, pageSize);
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
        return toDetailResponse(post);
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
        post.setTitle(request.getTitle());
        post.setContent(request.getContent());
        post.setSummary(request.getSummary());
        post.setCoverImage(request.getCoverImage());
        post.setSlug(generateUniqueSlug(request.getTitle()));
        post.setStatus(PostStatus.valueOf(request.getStatus()));

        if (request.getCategoryId() != null) {
            Category category = categoryRepository.findById(request.getCategoryId())
                    .orElseThrow(() -> new BusinessException(404, "分类不存在"));
            post.setCategory(category);
        }

        if (request.getTagIds() != null && !request.getTagIds().isEmpty()) {
            Set<Tag> tags = new HashSet<>(tagRepository.findAllById(request.getTagIds()));
            post.setTags(tags);
        }

        return toDetailResponse(postRepository.save(post));
    }

    @Override
    @Transactional
    public PostDetailResponse updatePost(Long id, CreatePostRequest request) {
        Post post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文章不存在"));

        post.setTitle(request.getTitle());
        post.setContent(request.getContent());
        post.setSummary(request.getSummary());
        post.setCoverImage(request.getCoverImage());

        // Update status and set publishedAt if publishing
        if (request.getStatus() != null) {
            PostStatus newStatus = PostStatus.valueOf(request.getStatus());
            if (newStatus == PostStatus.PUBLISHED && post.getPublishedAt() == null) {
                post.setPublishedAt(LocalDateTime.now());
            }
            post.setStatus(newStatus);
        }

        if (request.getCategoryId() != null) {
            Category category = categoryRepository.findById(request.getCategoryId())
                    .orElseThrow(() -> new BusinessException(404, "分类不存在"));
            post.setCategory(category);
        }

        if (request.getTagIds() != null) {
            Set<Tag> tags = new HashSet<>(tagRepository.findAllById(request.getTagIds()));
            post.setTags(tags);
        }

        return toDetailResponse(postRepository.save(post));
    }

    @Override
    @Transactional
    public void deletePost(Long id) {
        if (!postRepository.existsById(id)) {
            throw new BusinessException(404, "文章不存在");
        }
        postRepository.deleteById(id);
    }

    @Override
    @Transactional
    public void publishPost(Long id) {
        Post post = postRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "文章不存在"));
        post.setStatus(PostStatus.PUBLISHED);
        post.setPublishedAt(LocalDateTime.now());
        postRepository.save(post);
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
        response.setCoverImage(post.getCoverImage());
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
        response.setContent(post.getContent());
        response.setSummary(post.getSummary());
        response.setCoverImage(post.getCoverImage());
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
}
