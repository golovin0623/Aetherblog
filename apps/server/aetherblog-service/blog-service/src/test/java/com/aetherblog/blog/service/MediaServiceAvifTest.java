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
public class MediaServiceAvifTest {

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
    void upload_WithValidAvif_ShouldSucceed() {
        // Valid AVIF header:
        // 0-3: size (00 00 00 1C)
        // 4-7: ftyp (66 74 79 70)
        // 8-11: avif (61 76 69 66)
        byte[] avifContent = new byte[]{
                0x00, 0x00, 0x00, 0x1C,
                0x66, 0x74, 0x79, 0x70,
                0x61, 0x76, 0x69, 0x66,
                0x00, 0x00, 0x00, 0x00 // dummy rest
        };

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "image.avif",
                "image/avif",
                avifContent
        );

        when(mediaFileRepository.save(any(MediaFile.class))).thenAnswer(invocation -> invocation.getArgument(0));

        MediaFile result = mediaService.upload(file, 1L, null);
        assertNotNull(result);
        assertEquals("image.avif", result.getOriginalName());
    }

    @Test
    void upload_WithSpoofedAvif_ShouldThrowException() {
        // Spoofed AVIF (MP4 renamed to .avif):
        // 0-3: size
        // 4-7: ftyp
        // 8-11: isom (69 73 6F 6D) - typical for MP4
        byte[] spoofedContent = new byte[]{
                0x00, 0x00, 0x00, 0x20,
                0x66, 0x74, 0x79, 0x70,
                0x69, 0x73, 0x6F, 0x6D,
                0x00, 0x00, 0x00, 0x00
        };

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "spoofed.avif",
                "image/avif",
                spoofedContent
        );

        BusinessException exception = assertThrows(BusinessException.class, () -> {
            mediaService.upload(file, 1L, null);
        });
        assertTrue(exception.getMessage().contains("文件内容与扩展名不匹配"));
    }

    @Test
    void upload_WithShortAvif_ShouldThrowException() {
        // Short file < 12 bytes
        byte[] shortContent = new byte[]{
                0x00, 0x00, 0x00, 0x1C,
                0x66, 0x74, 0x79, 0x70,
                0x61, 0x76 // truncated
        };

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "short.avif",
                "image/avif",
                shortContent
        );

        assertThrows(BusinessException.class, () -> {
            mediaService.upload(file, 1L, null);
        });
    }
}
