package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.SiteSetting;
import com.aetherblog.blog.entity.SiteSetting.SettingType;
import com.aetherblog.blog.repository.SiteSettingRepository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 站点设置业务服务
 * 
 * @ref §10 - 站点设置管理
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SiteSettingService {

    private final SiteSettingRepository settingRepository;
    private final ObjectMapper objectMapper;

    /**
     * 获取字符串类型设置
     */
    public String getString(String key) {
        return getString(key, null);
    }

    /**
     * 获取字符串类型设置（带默认值）
     */
    public String getString(String key, String defaultValue) {
        return settingRepository.findBySettingKey(key)
                .map(SiteSetting::getSettingValue)
                .orElse(defaultValue);
    }

    /**
     * 获取布尔类型设置
     */
    public Boolean getBoolean(String key) {
        return getBoolean(key, false);
    }

    /**
     * 获取布尔类型设置（带默认值）
     */
    public Boolean getBoolean(String key, Boolean defaultValue) {
        return settingRepository.findBySettingKey(key)
                .map(s -> "true".equalsIgnoreCase(s.getSettingValue()))
                .orElse(defaultValue);
    }

    /**
     * 获取整数类型设置
     */
    public Integer getInteger(String key, Integer defaultValue) {
        return settingRepository.findBySettingKey(key)
                .map(s -> {
                    try {
                        return Integer.parseInt(s.getSettingValue());
                    } catch (NumberFormatException e) {
                        return defaultValue;
                    }
                })
                .orElse(defaultValue);
    }

    /**
     * 获取 JSON 类型设置并解析
     */
    public <T> T getJson(String key, TypeReference<T> typeRef) {
        return settingRepository.findBySettingKey(key)
                .map(s -> {
                    try {
                        return objectMapper.readValue(s.getSettingValue(), typeRef);
                    } catch (Exception e) {
                        log.warn("Failed to parse JSON setting: key={}", key, e);
                        return null;
                    }
                })
                .orElse(null);
    }

    /**
     * 获取指定分组的所有设置
     */
    public Map<String, Object> getSettingsByGroup(String groupName) {
        List<SiteSetting> settings = settingRepository.findByGroupName(groupName);
        return convertToMap(settings);
    }

    /**
     * 获取所有设置
     */
    public Map<String, Object> getAllSettings() {
        List<SiteSetting> settings = settingRepository.findAll();
        return convertToMap(settings);
    }

    /**
     * 获取公开设置（站点基本信息）
     * 过滤掉敏感设置只返回公开信息
     */
    public Map<String, Object> getPublicSettings() {
        Map<String, Object> result = new HashMap<>();

        // 获取基本设置组
        List<SiteSetting> generalSettings = settingRepository.findByGroupName("general");
        result.putAll(convertToMap(generalSettings));

        // 获取评论设置组
        List<SiteSetting> commentSettings = settingRepository.findByGroupName("comment");
        result.putAll(convertToMap(commentSettings));

        // 获取社交信息组
        List<SiteSetting> socialSettings = settingRepository.findByGroupName("social");
        result.putAll(convertToMap(socialSettings));

        // 获取外观设置组
        List<SiteSetting> appearanceSettings = settingRepository.findByGroupName("appearance");
        result.putAll(convertToMap(appearanceSettings));

        // 获取SEO设置组
        List<SiteSetting> seoSettings = settingRepository.findByGroupName("seo");
        result.putAll(convertToMap(seoSettings));

        // 获取作者信息组
        List<SiteSetting> authorSettings = settingRepository.findByGroupName("author");
        result.putAll(convertToMap(authorSettings));

        // 获取欢迎页设置组
        List<SiteSetting> welcomeSettings = settingRepository.findByGroupName("welcome");
        result.putAll(convertToMap(welcomeSettings));

        // 兼容旧代码，尝试获取 'site' 组（如果存在）
        List<SiteSetting> siteSettings = settingRepository.findByGroupName("site");
        if (!siteSettings.isEmpty()) {
            result.putAll(convertToMap(siteSettings));
        }

        // 添加一些默认值
        result.putIfAbsent("name", "AetherBlog");
        result.putIfAbsent("description", "A modern blog platform");
        result.putIfAbsent("author", "Admin");

        return result;
    }

    /**
     * 根据分组获取公开设置
     */
    public Map<String, Object> getPublicSettingsByGroup(String groupName) {
        return getSettingsByGroup(groupName);
    }

    /**
     * 更新设置值
     */
    @Transactional
    public void updateSetting(String key, String value) {
        Optional<SiteSetting> existing = settingRepository.findBySettingKey(key);
        if (existing.isPresent()) {
            SiteSetting setting = existing.get();
            setting.setSettingValue(value);
            settingRepository.save(setting);
            log.info("Updated site setting: key={}", key);
        } else {
            // 根据启发式规则自动创建缺失的设置
            log.info("Creating new site setting: key={}", key);
            
            String groupName = determineGroup(key);
            SettingType type = determineType(key);
            String description = "Auto-created setting";
            
            saveOrUpdate(key, value, type, groupName, description);
        }
    }

    private String determineGroup(String key) {
        if (key.startsWith("social_")) return "social";
        if (key.startsWith("author_")) return "author";
        if (key.startsWith("welcome_")) return "welcome";
        if (key.startsWith("seo_") || key.endsWith("_analytics_id")) return "seo";
        if (key.startsWith("site_")) return "general"; // 对应前端 'general' 分组
        if (key.startsWith("theme_") || key.equals("show_banner") || key.equals("custom_css") || key.equals("post_page_size")) return "appearance";
        if (key.startsWith("enable_") || key.equals("comment_need_audit") || key.equals("upload_max_size")) return "advanced";
        return "other";
    }

    private SettingType determineType(String key) {
        if (key.startsWith("enable_") || key.equals("show_banner") || key.equals("comment_need_audit")) return SettingType.BOOLEAN;
        if (key.endsWith("_size") || key.endsWith("_count") || key.endsWith("_limit")) return SettingType.NUMBER;
        return SettingType.STRING;
    }

    /**
     * 批量更新设置
     */
    @Transactional
    public void batchUpdate(Map<String, String> settings) {
        for (Map.Entry<String, String> entry : settings.entrySet()) {
            updateSetting(entry.getKey(), entry.getValue());
        }
    }

    /**
     * 创建或更新设置
     */
    @Transactional
    public SiteSetting saveOrUpdate(String key, String value, SettingType type, 
                                     String groupName, String description) {
        SiteSetting setting = settingRepository.findBySettingKey(key)
                .orElseGet(SiteSetting::new);
        
        setting.setSettingKey(key);
        setting.setSettingValue(value);
        setting.setSettingType(type);
        setting.setGroupName(groupName);
        setting.setDescription(description);
        
        return settingRepository.save(setting);
    }

    /**
     * 将设置列表转换为 Map
     */
    private Map<String, Object> convertToMap(List<SiteSetting> settings) {
        Map<String, Object> result = new HashMap<>();
        for (SiteSetting setting : settings) {
            Object value = convertValue(setting);
            result.put(setting.getSettingKey(), value);
        }
        return result;
    }

    /**
     * 根据类型转换值
     */
    private Object convertValue(SiteSetting setting) {
        if (setting.getSettingValue() == null) {
            return null;
        }
        
        return switch (setting.getSettingType()) {
            case BOOLEAN -> "true".equalsIgnoreCase(setting.getSettingValue());
            case NUMBER -> {
                try {
                    if (setting.getSettingValue().contains(".")) {
                        yield Double.parseDouble(setting.getSettingValue());
                    } else {
                        yield Long.parseLong(setting.getSettingValue());
                    }
                } catch (NumberFormatException e) {
                    yield setting.getSettingValue();
                }
            }
            case JSON -> {
                try {
                    yield objectMapper.readValue(setting.getSettingValue(), Object.class);
                } catch (Exception e) {
                    yield setting.getSettingValue();
                }
            }
            default -> setting.getSettingValue();
        };
    }
}
