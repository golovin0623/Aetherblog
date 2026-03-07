package com.aetherblog.blog.dto.request;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;

@JsonIgnoreProperties(ignoreUnknown = true)
public record VanBlogFriendLinkPayload(
        String url,
        String name,
        String desc,
        String logo,
        LocalDateTime updatedAt
) {}
