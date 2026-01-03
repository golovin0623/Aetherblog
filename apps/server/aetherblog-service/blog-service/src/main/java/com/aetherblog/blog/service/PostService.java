package com.aetherblog.blog.service;

import com.aetherblog.blog.dto.request.CreatePostRequest;
import com.aetherblog.blog.dto.response.PostDetailResponse;
import com.aetherblog.blog.dto.response.PostListResponse;
import com.aetherblog.blog.entity.Post;
import com.aetherblog.common.core.domain.PageResult;

import java.util.List;

/**
 * 文章服务接口
 */
public interface PostService {

    List<Post> getAllPublishedPosts();

    PageResult<PostListResponse> getPublishedPosts(int pageNum, int pageSize);

    /**
     * 管理后台获取文章列表（支持状态筛选和关键词搜索）
     * @param status 状态筛选：null=全部, PUBLISHED=已发布, DRAFT=草稿
     * @param keyword 关键词搜索（标题/内容）
     * @param pageNum 页码
     * @param pageSize 每页数量
     */
    PageResult<PostListResponse> getPostsForAdmin(String status, String keyword, int pageNum, int pageSize);

    PageResult<PostListResponse> getPostsByCategory(Long categoryId, int pageNum, int pageSize);

    PageResult<PostListResponse> getPostsByTag(Long tagId, int pageNum, int pageSize);

    PostDetailResponse getPostById(Long id);

    PostDetailResponse getPostBySlug(String slug);

    PostDetailResponse createPost(CreatePostRequest request);

    PostDetailResponse updatePost(Long id, CreatePostRequest request);

    void deletePost(Long id);

    void publishPost(Long id);

    void incrementViewCount(Long id);
}
