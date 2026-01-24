package com.aetherblog.common.redis.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;

import java.time.Duration;

/**
 * Spring Cache 配置
 */
@Configuration
@EnableCaching
@SuppressWarnings("null")
public class CacheConfig {

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory connectionFactory, ObjectMapper objectMapper) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofHours(1))
                .serializeValuesWith(RedisSerializationContext.SerializationPair
                        .fromSerializer(new GenericJackson2JsonRedisSerializer(objectMapper)))
                .disableCachingNullValues();

        return RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(config)
                .withCacheConfiguration("posts", config.entryTtl(Duration.ofMinutes(30)))
                .withCacheConfiguration("users", config.entryTtl(Duration.ofHours(2)))
                .withCacheConfiguration("categories", config.entryTtl(Duration.ofDays(1)))
                // Phase 6: 媒体库缓存配置
                .withCacheConfiguration("folderTree", config.entryTtl(Duration.ofMinutes(5)))
                .withCacheConfiguration("mediaFiles", config.entryTtl(Duration.ofMinutes(10)))
                .withCacheConfiguration("mediaTags", config.entryTtl(Duration.ofMinutes(15)))
                .build();
    }
}
