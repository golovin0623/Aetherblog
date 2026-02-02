package com.aetherblog.blog.config;

import lombok.extern.slf4j.Slf4j;
import org.apache.http.HttpHost;
import org.elasticsearch.client.RestClient;
import org.elasticsearch.client.RestClientBuilder;
import org.elasticsearch.client.RestHighLevelClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.net.URI;
import java.util.List;

/**
 * Elasticsearch 客户端配置
 *
 * @description 集成 RestHighLevelClient 用于搜索引擎操作及健康检查
 * @ref §2.5 - 数据存储架构
 */
@Slf4j
@Configuration
public class ElasticsearchConfig {

    @Value("${spring.elasticsearch.uris:http://localhost:9200}")
    private List<String> uris;

    @Bean(destroyMethod = "close")
    public RestHighLevelClient restHighLevelClient() {
        log.info("Initializing Elasticsearch RestHighLevelClient");

        HttpHost[] hosts = uris.stream()
                .map(uriStr -> {
                    try {
                        URI uri = URI.create(uriStr);
                        return new HttpHost(uri.getHost(), uri.getPort() == -1 ? 9200 : uri.getPort(), uri.getScheme());
                    } catch (Exception e) {
                        log.error("Invalid Elasticsearch URI format detected");
                        return new HttpHost("localhost", 9200, "http");
                    }
                })
                .toArray(HttpHost[]::new);

        RestClientBuilder builder = RestClient.builder(hosts);

        // 设置超时等参数 (可选)
        builder.setRequestConfigCallback(requestConfigBuilder ->
            requestConfigBuilder.setConnectTimeout(5000).setSocketTimeout(30000));

        return new RestHighLevelClient(builder);
    }
}
