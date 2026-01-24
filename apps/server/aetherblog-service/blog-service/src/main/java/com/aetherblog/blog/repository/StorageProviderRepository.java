package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.blog.entity.StorageProvider.ProviderType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 存储提供商仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 3: 云存储与CDN
 * @author AI Assistant
 * @since 2.3.0
 */
@Repository
public interface StorageProviderRepository extends JpaRepository<StorageProvider, Long> {

    /**
     * 获取默认存储提供商
     */
    Optional<StorageProvider> findByIsDefaultTrue();

    /**
     * 根据名称查找
     */
    Optional<StorageProvider> findByName(String name);

    /**
     * 检查名称是否存在
     */
    boolean existsByName(String name);

    /**
     * 获取所有启用的提供商
     */
    List<StorageProvider> findByIsEnabledTrueOrderByPriorityDesc();

    /**
     * 根据类型查找
     */
    List<StorageProvider> findByProviderType(ProviderType providerType);

    /**
     * 清除所有默认标记
     */
    @Modifying
    @Query("UPDATE StorageProvider s SET s.isDefault = false WHERE s.isDefault = true")
    void clearAllDefaults();

    /**
     * 设置为默认
     */
    @Modifying
    @Query("UPDATE StorageProvider s SET s.isDefault = true WHERE s.id = :id")
    void setAsDefault(@Param("id") Long id);
}
