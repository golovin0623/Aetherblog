package com.aetherblog.blog.service;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.repository.MediaFileRepository;
import com.aetherblog.blog.repository.MediaFolderRepository;
import com.aetherblog.blog.repository.UserRepository;
import com.aetherblog.blog.service.impl.MediaServiceImpl;
import com.aetherblog.common.core.exception.BusinessException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class MediaServiceTest {

    @Mock
    private MediaFileRepository mediaFileRepository;
    @Mock
    private MediaFolderRepository mediaFolderRepository;
    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private MediaServiceImpl mediaService;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(mediaService, "uploadBasePath", tempDir.toString());
        ReflectionTestUtils.setField(mediaService, "uploadUrlPrefix", "/uploads");
    }

    @Test
    void upload_WithDangerousExtension_ShouldThrowException() {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "malicious.jsp",
                "application/x-jsp",
                "<% out.println(\"hacked\"); %>".getBytes()
        );

        BusinessException exception = assertThrows(BusinessException.class, () -> {
            mediaService.upload(file, 1L, null);
        });

        // 如果需要可以验证消息，但目前只预期抛出异常就足够了
    }

    @Test
    void upload_WithSafeExtension_ShouldSucceed() {
        // Use real JPEG magic bytes (FF D8 FF)
        byte[] jpegContent = new byte[]{(byte)0xFF, (byte)0xD8, (byte)0xFF, 0x01, 0x02};
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "image.jpg",
                "image/jpeg",
                jpegContent
        );

        when(mediaFileRepository.save(any(MediaFile.class))).thenAnswer(invocation -> invocation.getArgument(0));

        MediaFile result = mediaService.upload(file, 1L, null);
        assertNotNull(result);
        assertEquals("image.jpg", result.getOriginalName());
    }

    @Test
    void upload_WithSvgExtension_ShouldThrowException() {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "image.svg",
                "image/svg+xml",
                "<svg onload=\"alert(1)\"></svg>".getBytes()
        );

        assertThrows(BusinessException.class, () -> {
            mediaService.upload(file, 1L, null);
        });
    }

    @Test
    void upload_WithXmlExtension_ShouldThrowException() {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "data.xml",
                "application/xml",
                "<?xml version=\"1.0\"?><data>test</data>".getBytes()
        );

        assertThrows(BusinessException.class, () -> {
            mediaService.upload(file, 1L, null);
        });
    }
}
