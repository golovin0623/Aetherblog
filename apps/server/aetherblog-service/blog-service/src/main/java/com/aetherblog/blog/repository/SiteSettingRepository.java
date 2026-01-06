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
     * 根据 settingKey 查找设置
     */
    Optional<SiteSetting> findBySettingKey(String settingKey);

    /**
     * 根据分组查找设置
     */
    List<SiteSetting> findByGroupName(String groupName);

    /**
     * 检查 settingKey 是否存在
     */
    boolean existsBySettingKey(String settingKey);

    /**
     * 根据 settingKey 更新值
     */
    @Modifying
    @Query("UPDATE SiteSetting s SET s.settingValue = :value WHERE s.settingKey = :key")
    int updateValueBySettingKey(@Param("key") String settingKey, @Param("value") String value);

    /**
     * 根据多个 settingKey 查找设置
     */
    List<SiteSetting> findBySettingKeyIn(List<String> settingKeys);
}
