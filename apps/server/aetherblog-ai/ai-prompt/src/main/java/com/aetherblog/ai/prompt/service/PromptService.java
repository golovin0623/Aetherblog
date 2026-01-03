package com.aetherblog.ai.prompt.service;

import com.aetherblog.ai.prompt.entity.PromptTemplate;
import com.aetherblog.ai.prompt.entity.PromptTemplate.PromptCategory;
import com.aetherblog.ai.prompt.repository.PromptRepository;
import com.aetherblog.common.core.exception.BusinessException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Prompt 服务实现
 */
@Service
@RequiredArgsConstructor
@SuppressWarnings("null")
public class PromptService {

    private final PromptRepository promptRepository;

    /**
     * 获取所有激活的模板
     */
    public List<PromptTemplate> getAllActive() {
        return promptRepository.findByActiveTrue();
    }

    /**
     * 按类别获取模板
     */
    public List<PromptTemplate> getByCategory(PromptCategory category) {
        return promptRepository.findByCategoryAndActiveTrue(category);
    }

    /**
     * 按名称获取模板
     */
    public PromptTemplate getByName(String name) {
        return promptRepository.findByName(name)
                .orElseThrow(() -> new BusinessException(404, "Prompt模板不存在: " + name));
    }

    /**
     * 渲染模板（变量替换）
     */
    public String render(String templateName, Map<String, String> variables) {
        PromptTemplate template = getByName(templateName);
        String result = template.getTemplate();
        
        for (Map.Entry<String, String> entry : variables.entrySet()) {
            result = result.replace("{{" + entry.getKey() + "}}", entry.getValue());
        }
        
        return result;
    }

    /**
     * 创建模板
     */
    public PromptTemplate create(PromptTemplate template) {
        if (promptRepository.existsByName(template.getName())) {
            throw new BusinessException(400, "模板名称已存在");
        }
        return promptRepository.save(template);
    }

    /**
     * 更新模板
     */
    public PromptTemplate update(Long id, PromptTemplate template) {
        PromptTemplate existing = promptRepository.findById(id)
                .orElseThrow(() -> new BusinessException(404, "模板不存在"));
        existing.setDescription(template.getDescription());
        existing.setTemplate(template.getTemplate());
        existing.setCategory(template.getCategory());
        return promptRepository.save(existing);
    }

    /**
     * 删除模板
     */
    public void delete(Long id) {
        promptRepository.deleteById(id);
    }
}
