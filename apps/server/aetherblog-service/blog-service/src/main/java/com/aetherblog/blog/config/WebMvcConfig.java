package com.aetherblog.blog.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC 配置
 * 配置静态资源映射，使上传的文件可以通过 URL 访问
 *
 * @author AI Assistant
 * @since 1.0.0
 * @ref §8.2-4 - 媒体管理模块
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Value("${aetherblog.upload.path:./uploads}")
    private String uploadBasePath;

    @Value("${aetherblog.upload.url-prefix:/uploads}")
    private String uploadUrlPrefix;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
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
