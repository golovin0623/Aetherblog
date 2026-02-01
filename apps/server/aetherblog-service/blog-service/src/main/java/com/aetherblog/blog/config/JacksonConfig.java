package com.aetherblog.blog.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * Jackson配置
 *
 * @author AI Assistant
 * @since 2.1.0
 */
@Slf4j
@Configuration
public class JacksonConfig {

    @Bean
    @Primary
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();

        // 注册 JavaTimeModule 以支持 Java 8 日期/时间
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        // 禁用对空 Bean 报错（针对 Hibernate 代理）
        mapper.disable(SerializationFeature.FAIL_ON_EMPTY_BEANS);

        log.info("ObjectMapper configured with JavaTimeModule");
        return mapper;
    }
}
