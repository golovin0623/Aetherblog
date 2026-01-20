package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.MediaVariant;
import com.aetherblog.blog.entity.MediaVariant.VariantType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 媒体变体仓储接口
 *
 * @ref 媒体库深度优化方案 - Phase 4: 图像处理
 * @author AI Assistant
 * @since 2.4.0
 */
@Repository
public interface MediaVariantRepository extends JpaRepository<MediaVariant, Long> {

    /**
     * 查找文件的所有变体
     */
    List<MediaVariant> findByMediaFileId(Long mediaFileId);

    /**
     * 查找文件的指定类型变体
     */
    Optional<MediaVariant> findByMediaFileIdAndVariantType(Long mediaFileId, VariantType variantType);

    /**
     * 删除文件的所有变体
     */
    void deleteByMediaFileId(Long mediaFileId);

    /**
     * 检查变体是否存在
     */
    boolean existsByMediaFileIdAndVariantType(Long mediaFileId, VariantType variantType);
}
