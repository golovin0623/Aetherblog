package com.aetherblog.ai.prompt.repository;

import com.aetherblog.ai.prompt.entity.PromptTemplate;
import com.aetherblog.ai.prompt.entity.PromptTemplate.PromptCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * Prompt 模板仓库
 */
@Repository
public interface PromptRepository extends JpaRepository<PromptTemplate, Long> {

    Optional<PromptTemplate> findByName(String name);

    List<PromptTemplate> findByCategoryAndActiveTrue(PromptCategory category);

    List<PromptTemplate> findByActiveTrue();

    boolean existsByName(String name);
}
