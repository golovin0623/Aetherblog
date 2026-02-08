package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaFile.FileType;
import com.aetherblog.blog.entity.MediaFile.StorageType;
import com.aetherblog.blog.entity.MediaFolder;
import com.aetherblog.blog.entity.User;
import com.aetherblog.blog.repository.MediaFileRepository;
import com.aetherblog.blog.repository.MediaFolderRepository;
import com.aetherblog.blog.repository.UserRepository;
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

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class MediaServiceSecurityTest {

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
        ReflectionTestUtils.setField(mediaService, "trashCleanupDays", 120);
    }

    @Test
    void testUpload_MaliciousContent_ShouldThrowException() {
        // Create a fake PNG file with PHP content
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "malicious.png",
                "image/png",
                "<?php system('rm -rf /'); ?>".getBytes()
        );

        // Expect BusinessException because content doesn't match PNG signature
        // Note: Currently this test will FAIL (pass the upload) until we implement the fix
        BusinessException exception = assertThrows(BusinessException.class, () -> {
            mediaService.upload(file, null, null);
        });

        assertTrue(exception.getMessage().contains("文件内容与扩展名不匹配") ||
                   exception.getMessage().contains("File content does not match"),
                   "Should throw exception for mismatched content type");
    }

    @Test
    void testUpload_ValidPng_ShouldSuccess() {
        // Create a valid PNG file (using minimal PNG signature)
        byte[] pngSignature = new byte[]{(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "valid.png",
                "image/png",
                pngSignature
        );

        when(mediaFileRepository.save(any(MediaFile.class))).thenAnswer(invocation -> {
            MediaFile mf = invocation.getArgument(0);
            mf.setId(1L);
            return mf;
        });

        MediaFile result = mediaService.upload(file, null, null);

        assertNotNull(result);
        assertEquals("valid.png", result.getOriginalName());
    }

    @Test
    void testUpload_ValidJpg_ShouldSuccess() {
        // Create a valid JPG file (using minimal JPG signature)
        byte[] jpgSignature = new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF};
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "valid.jpg",
                "image/jpeg",
                jpgSignature
        );

        when(mediaFileRepository.save(any(MediaFile.class))).thenAnswer(invocation -> {
            MediaFile mf = invocation.getArgument(0);
            mf.setId(2L);
            return mf;
        });

        MediaFile result = mediaService.upload(file, null, null);

        assertNotNull(result);
        assertEquals("valid.jpg", result.getOriginalName());
    }
}
