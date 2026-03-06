package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.StorageProvider;
import com.aetherblog.common.core.exception.BusinessException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class LocalStorageServiceImplTest {

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private LocalStorageServiceImpl localStorageService;

    private StorageProvider provider;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(localStorageService, "defaultBasePath", "./uploads");
        ReflectionTestUtils.setField(localStorageService, "defaultUrlPrefix", "/uploads");

        provider = new StorageProvider();
        provider.setConfigJson("{}");
    }

    @Test
    void upload_shouldThrowExceptionOnPathTraversal() throws IOException {
        MultipartFile file = mock(MultipartFile.class);

        when(objectMapper.readTree("{}")).thenReturn(new ObjectMapper().readTree("{}"));

        BusinessException exception = assertThrows(BusinessException.class, () -> {
            localStorageService.upload(file, provider, "../../../etc/passwd");
        });

        assertTrue(exception.getMessage().contains("非法"));
    }
}
