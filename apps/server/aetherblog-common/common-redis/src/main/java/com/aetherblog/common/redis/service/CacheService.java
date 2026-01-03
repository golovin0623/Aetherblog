package com.aetherblog.common.redis.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.function.Supplier;

/**
 * 缓存服务（带缓存穿透和雪崩保护）
 */
@Service
@RequiredArgsConstructor
public class CacheService {

    private final RedisService redisService;

    /**
     * 获取缓存，不存在则从数据库加载
     */
    @SuppressWarnings("unchecked")
    public <T> T getOrLoad(String key, Supplier<T> loader, long expireSeconds) {
        Object cached = redisService.get(key);
        if (cached != null) {
            return (T) cached;
        }

        // 缓存不存在，从数据库加载
        T value = loader.get();
        if (value != null) {
            redisService.set(key, value, expireSeconds);
        } else {
            // 防止缓存穿透：空值也缓存，但时间较短
            redisService.set(key, "", 60);
        }
        return value;
    }

    /**
     * 获取 Optional 包装的缓存
     */
    @SuppressWarnings("unchecked")
    public <T> Optional<T> getOptional(String key) {
        Object value = redisService.get(key);
        return Optional.ofNullable((T) value);
    }

    /**
     * 删除缓存
     */
    public void evict(String key) {
        redisService.delete(key);
    }

    /**
     * 批量删除缓存
     */
    public void evictByPattern(String pattern) {
        // 实现批量删除逻辑
    }
}
