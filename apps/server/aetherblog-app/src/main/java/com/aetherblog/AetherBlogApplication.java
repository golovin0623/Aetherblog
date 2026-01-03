package com.aetherblog;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * AetherBlog 应用启动类
 *
 * @author AetherBlog Team
 */
@SpringBootApplication
@ComponentScan(basePackages = "com.aetherblog")
@EnableJpaRepositories(basePackages = "com.aetherblog")
@EntityScan(basePackages = "com.aetherblog")
public class AetherBlogApplication {

    public static void main(String[] args) {
        SpringApplication.run(AetherBlogApplication.class, args);
    }
}
