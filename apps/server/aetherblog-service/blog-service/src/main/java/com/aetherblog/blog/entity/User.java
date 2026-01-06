package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 用户实体
 * 
 * @ref §4.2.1 - 用户表结构设计
 */
@Data
@Entity
@Table(name = "users", indexes = {
    @Index(name = "idx_users_username", columnList = "username"),
    @Index(name = "idx_users_email", columnList = "email"),
    @Index(name = "idx_users_status", columnList = "status")
})
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 用户名
     */
    @Column(nullable = false, unique = true, length = 50)
    private String username;

    /**
     * 邮箱
     */
    @Column(nullable = false, unique = true, length = 100)
    private String email;

    /**
     * 密码哈希
     */
    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    /**
     * 昵称
     */
    @Column(length = 50)
    private String nickname;

    /**
     * 头像URL
     */
    @Column(length = 500)
    private String avatar;

    /**
     * 个人简介
     */
    @Column(columnDefinition = "TEXT")
    private String bio;

    /**
     * 角色: ADMIN-管理员, AUTHOR-作者, USER-普通用户
     */
    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private UserRole role = UserRole.USER;

    /**
     * 状态: ACTIVE-正常, INACTIVE-未激活, BANNED-封禁
     */
    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private UserStatus status = UserStatus.ACTIVE;

    /**
     * 最后登录时间
     */
    @Column(name = "last_login_at")
    private LocalDateTime lastLoginAt;

    /**
     * 最后登录IP
     */
    @Column(name = "last_login_ip", length = 50)
    private String lastLoginIp;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * 是否必须修改密码（首次登录时强制修改）
     */
    @Column(name = "must_change_password", nullable = false)
    private Boolean mustChangePassword = false;

    /**
     * 用户角色枚举
     */
    public enum UserRole {
        ADMIN, AUTHOR, USER
    }

    /**
     * 用户状态枚举
     */
    public enum UserStatus {
        ACTIVE, INACTIVE, BANNED
    }
}
