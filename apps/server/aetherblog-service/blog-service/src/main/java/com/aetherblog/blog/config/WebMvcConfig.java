package com.aetherblog.blog.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/**
 * Web MVC 配置
 * 配置静态资源映射，使上传的文件可以通过 URL 访问
 *
 * @author AI Assistant
 * @since 1.0.0
 * @ref §8.2-4 - 媒体管理模块
 */
@Slf4j
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final ObjectMapper objectMapper;

    @Value("${aetherblog.upload.path:./uploads}")
    private String uploadBasePath;

    @Value("${aetherblog.upload.url-prefix:/uploads}")
    private String uploadUrlPrefix;

    public WebMvcConfig(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        log.info("WebMvcConfig initialized with ObjectMapper");
    }

    @Override
    public void configureMessageConverters(@NonNull List<HttpMessageConverter<?>> converters) {
        // 首先添加我们自定义的 Jackson 转换器
        MappingJackson2HttpMessageConverter converter = new MappingJackson2HttpMessageConverter();
        converter.setObjectMapper(objectMapper);
        converters.add(0, converter);
        log.info("Added custom Jackson message converter with JavaTimeModule");
    }

    @Override
    public void extendMessageConverters(@NonNull List<HttpMessageConverter<?>> converters) {
        // 同时替换任何现有的 Jackson 转换器
        for (int i = 0; i < converters.size(); i++) {
            HttpMessageConverter<?> converter = converters.get(i);
            if (converter instanceof MappingJackson2HttpMessageConverter) {
                MappingJackson2HttpMessageConverter jacksonConverter = new MappingJackson2HttpMessageConverter();
                jacksonConverter.setObjectMapper(objectMapper);
                converters.set(i, jacksonConverter);
                log.info("Replaced Jackson message converter #{} with custom ObjectMapper", i);
            }
        }
    }

    @Override
    public void addResourceHandlers(@NonNull ResourceHandlerRegistry registry) {
        // 将 /uploads/** 映射到文件系统的 uploads 目录
        // 例如: /uploads/2026/01/09/abc.png -> ./uploads/2026/01/09/abc.png
        String resourcePath = uploadUrlPrefix + "/**";
        String resourceLocation = "file:" + normalizeUploadPath() + "/";

        registry.addResourceHandler(resourcePath)
                .addResourceLocations(resourceLocation)
                .setCachePeriod(86400); // 缓存1天
    }

    /**
     * 标准化上传路径，确保是绝对路径
     */
    private String normalizeUploadPath() {
        if (uploadBasePath.startsWith("./")) {
            return System.getProperty("user.dir") + uploadBasePath.substring(1);
        }
        if (!uploadBasePath.startsWith("/")) {
            return System.getProperty("user.dir") + "/" + uploadBasePath;
        }
        return uploadBasePath;
    }
}
