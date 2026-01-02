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
