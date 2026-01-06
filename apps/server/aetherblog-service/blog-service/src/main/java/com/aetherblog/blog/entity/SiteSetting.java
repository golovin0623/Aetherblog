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
    @Index(name = "idx_site_settings_key", columnList = "setting_key"),
    @Index(name = "idx_site_settings_group", columnList = "group_name")
})
public class SiteSetting {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 设置键名（唯一）
     */
    @Column(name = "setting_key", nullable = false, unique = true, length = 100)
    private String settingKey;

    /**
     * 设置值
     */
    @Lob
    @Column(name = "setting_value", columnDefinition = "TEXT")
    private String settingValue;

    /**
     * 值类型: STRING, NUMBER, BOOLEAN, JSON, TEXT
     */
    @Column(name = "setting_type", nullable = false, length = 20)
    @Enumerated(EnumType.STRING)
    private SettingType settingType = SettingType.STRING;

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
