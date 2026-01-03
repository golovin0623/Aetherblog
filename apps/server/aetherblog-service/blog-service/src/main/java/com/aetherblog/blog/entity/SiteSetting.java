package com.aetherblog.blog.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 站点设置实体
 * 
 * 采用 Key-Value 存储模式，支持多种数据类型。
 * 
 * @ref §10 - 站点设置表设计
 */
@Data
@Entity
@Table(name = "site_settings", indexes = {
    @Index(name = "idx_site_settings_group", columnList = "group_name"),
    @Index(name = "idx_site_settings_public", columnList = "is_public")
})
public class SiteSetting {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 设置键名（唯一）
     */
    @Column(name = "key", nullable = false, unique = true, length = 100)
    private String key;

    /**
     * 设置值
     */
    @Lob
    @Column(columnDefinition = "TEXT")
    private String value;

    /**
     * 值类型: STRING, NUMBER, BOOLEAN, JSON, TEXT
     */
    @Column(nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private SettingType type = SettingType.STRING;

    /**
     * 分组名称
     */
    @Column(name = "group_name", nullable = false, length = 50)
    private String groupName = "general";

    /**
     * 设置描述
     */
    @Column(length = 500)
    private String description;

    /**
     * 是否公开（前台可见）
     */
    @Column(name = "is_public", nullable = false)
    private Boolean isPublic = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * 设置值类型枚举
     */
    public enum SettingType {
        STRING, NUMBER, BOOLEAN, JSON, TEXT
    }
}
