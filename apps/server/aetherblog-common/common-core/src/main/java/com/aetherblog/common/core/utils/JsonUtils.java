package com.aetherblog.common.core.utils;

import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
// import tools.jackson.datatype.jsr310.JavaTimeModule;

/**
 * JSON工具类
 * 
 * Jackson 3.x (tools.jackson) 迁移:
 * - JsonProcessingException → JacksonException
 * - ObjectMapper.configure() → JsonMapper.builder().enable/disable()
 * - SerializationFeature.WRITE_DATES_AS_TIMESTAMPS 已移除 (使用 JavaTimeModule 默认值)
 */
public class JsonUtils {

    private static final ObjectMapper OBJECT_MAPPER = JsonMapper.builder()
            // 修复: 本地缺少 JavaTimeModule 依赖 (jackson-datatype-jsr310) 3.0.3
            // .addModule(new JavaTimeModule())
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build();

    private JsonUtils() {}

    /**
     * 对象转JSON字符串
     */
    public static String toJson(Object obj) {
        if (obj == null) return null;
        try {
            return OBJECT_MAPPER.writeValueAsString(obj);
        } catch (JacksonException e) {
            throw new RuntimeException("JSON序列化失败", e);
        }
    }

    /**
     * JSON字符串转对象
     */
    public static <T> T fromJson(String json, Class<T> clazz) {
        if (json == null || json.isEmpty()) return null;
        try {
            return OBJECT_MAPPER.readValue(json, clazz);
        } catch (JacksonException e) {
            throw new RuntimeException("JSON反序列化失败", e);
        }
    }

    /**
     * JSON字符串转对象（泛型）
     */
    public static <T> T fromJson(String json, TypeReference<T> typeReference) {
        if (json == null || json.isEmpty()) return null;
        try {
            return OBJECT_MAPPER.readValue(json, typeReference);
        } catch (JacksonException e) {
            throw new RuntimeException("JSON反序列化失败", e);
        }
    }

    /**
     * 对象转JSON字符串（格式化）
     */
    public static String toPrettyJson(Object obj) {
        if (obj == null) return null;
        try {
            return OBJECT_MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(obj);
        } catch (JacksonException e) {
            throw new RuntimeException("JSON序列化失败", e);
        }
    }

    /**
     * 获取ObjectMapper实例
     */
    public static ObjectMapper getObjectMapper() {
        return OBJECT_MAPPER;
    }
}
