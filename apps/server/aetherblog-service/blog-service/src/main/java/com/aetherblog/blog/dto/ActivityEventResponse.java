package com.aetherblog.blog.dto;

import lombok.Data;
import lombok.Builder;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 活动事件响应 DTO
 * 
 * @ref §8.2 - 仪表盘最近动态
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ActivityEventResponse {

    private Long id;

    /**
     * 事件类型代码
     */
    private String eventType;

    /**
     * 事件分类
     */
    private String eventCategory;

    /**
     * 事件标题
     */
    private String title;

    /**
     * 事件描述
     */
    private String description;

    /**
     * 扩展元数据
     */
    private Map<String, Object> metadata;

    /**
     * 触发用户信息
     */
    private UserInfo user;

    /**
     * IP 地址
     */
    private String ip;

    /**
     * 事件状态
     */
    private String status;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;

    /**
     * 用户简要信息
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UserInfo {
        private Long id;
        private String username;
        private String nickname;
        private String avatar;
    }
}
