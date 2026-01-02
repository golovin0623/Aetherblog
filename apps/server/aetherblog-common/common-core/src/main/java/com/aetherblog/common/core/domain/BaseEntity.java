package com.aetherblog.common.core.domain;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 基础实体类
 */
@Data
@MappedSuperclass
public abstract class BaseEntity implements Serializable {

    /**
     * 创建时间
     */
    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * 创建者
     */
    @Column(name = "created_by", length = 64)
    private String createdBy;

    /**
     * 更新者
     */
    @Column(name = "updated_by", length = 64)
    private String updatedBy;

    /**
     * 删除标记
     */
    @Column(name = "deleted")
    private Boolean deleted = false;
}
