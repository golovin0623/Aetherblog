package com.aetherblog.config;

import com.aetherblog.api.vo.PostVO;
import com.aetherblog.blog.dto.response.PostDetailResponse;
import com.aetherblog.blog.dto.response.PostListResponse;
import io.jsonwebtoken.Claims;
import org.springframework.aot.hint.MemberCategory;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.ImportRuntimeHints;

/**
 * GraalVM Native Image 配置
 * 
 * 注册反射、序列化和资源 Hints，确保 Native Image 正确运行。
 *
 * @author AetherBlog Team
 */
@Configuration
@ImportRuntimeHints(NativeImageConfiguration.NativeHints.class)
public class NativeImageConfiguration {

    static class NativeHints implements RuntimeHintsRegistrar {
        @Override
        public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
            // ========== JWT 相关类 ==========
            hints.reflection()
                .registerType(Claims.class, MemberCategory.values());
            
            // ========== API VO/DTO 类 ==========
            hints.reflection()
                .registerType(PostVO.class, MemberCategory.values())
                .registerType(PostDetailResponse.class, MemberCategory.values())
                .registerType(PostListResponse.class, MemberCategory.values());
            
            // ========== 资源文件 ==========
            hints.resources()
                .registerPattern("db/migration/*")
                .registerPattern("application*.yml")
                .registerPattern("application*.yaml")
                .registerPattern("logback*.xml");
        }
    }
}
