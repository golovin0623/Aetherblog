package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.dto.request.CreatePostRequest;
import com.aetherblog.blog.dto.response.PostDetailResponse;
import com.aetherblog.blog.entity.Post;
import com.aetherblog.blog.entity.Post.PostStatus;
import com.aetherblog.blog.repository.CategoryRepository;
import com.aetherblog.blog.repository.PostRepository;
import com.aetherblog.blog.repository.TagRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.util.Optional;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class PostDraftTest {

    @Mock
    private PostRepository postRepository;

    @Mock
    private StringRedisTemplate stringRedisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @Mock
    private ObjectMapper objectMapper;

    @Mock
    private CategoryRepository categoryRepository;
    
    @Mock
    private TagRepository tagRepository;

    @InjectMocks
    private PostServiceImpl postService;

    @BeforeEach
    void setUp() {
        lenient().when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void testSaveDraft_Success() throws Exception {
        Long postId = 1L;
        CreatePostRequest request = new CreatePostRequest();
        request.setTitle("Draft Title");
        request.setContent("Draft content");

        when(postRepository.existsById(postId)).thenReturn(true);
        when(objectMapper.writeValueAsString(request)).thenReturn("{\"title\":\"Draft Title\"}");

        postService.saveDraft(postId, request);

        verify(valueOperations).set(eq("post:draft:1"), anyString(), eq(7L), eq(TimeUnit.DAYS));
    }

    @Test
    void testGetPostById_WithDraft() throws Exception {
        Long postId = 1L;
        Post post = new Post();
        post.setId(postId);
        post.setTitle("Published Title");
        post.setStatus(PostStatus.PUBLISHED);
        post.setViewCount(0L);
        post.setCommentCount(0L);
        post.setLikeCount(0L);

        when(postRepository.findById(postId)).thenReturn(Optional.of(post));
        when(valueOperations.get("post:draft:1")).thenReturn("{\"title\":\"Draft Title\"}");
        
        CreatePostRequest draftRequest = new CreatePostRequest();
        draftRequest.setTitle("Draft Title");
        when(objectMapper.readValue(anyString(), eq(CreatePostRequest.class))).thenReturn(draftRequest);

        PostDetailResponse response = postService.getPostById(postId);

        assertNotNull(response);
        assertEquals("Published Title", response.getTitle());
        assertNotNull(response.getDraft());
        assertEquals("Draft Title", response.getDraft().getTitle());
    }

    @Test
    void testPublishPost_ClearsDraft() {
        Long postId = 1L;
        Post post = new Post();
        post.setId(postId);
        post.setStatus(PostStatus.DRAFT);

        when(postRepository.findById(postId)).thenReturn(Optional.of(post));

        postService.publishPost(postId);

        assertEquals(PostStatus.PUBLISHED, post.getStatus());
        verify(postRepository).save(post);
        verify(stringRedisTemplate).delete("post:draft:1");
    }
}
