package com.aetherblog.blog.repository;

import com.aetherblog.blog.entity.SiteSetting;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 站点设置数据仓库
 * 
 * @ref §10 - 站点设置表操作
 */
@Repository
public interface SiteSettingRepository extends JpaRepository<SiteSetting, Long> {

    /**
     * 根据 key 查找设置
     */
    Optional<SiteSetting> findByKey(String key);

    /**
     * 根据分组查找设置
     */
    List<SiteSetting> findByGroupName(String groupName);

    /**
     * 查找所有公开设置
     */
    List<SiteSetting> findByIsPublicTrue();

    /**
     * 查找指定分组的公开设置
     */
    List<SiteSetting> findByGroupNameAndIsPublicTrue(String groupName);

    /**
     * 检查 key 是否存在
     */
    boolean existsByKey(String key);

    /**
     * 根据 key 更新值
     */
    @Modifying
    @Query("UPDATE SiteSetting s SET s.value = :value WHERE s.key = :key")
    int updateValueByKey(@Param("key") String key, @Param("value") String value);

    /**
     * 根据多个 key 查找设置
     */
    List<SiteSetting> findByKeyIn(List<String> keys);
}
