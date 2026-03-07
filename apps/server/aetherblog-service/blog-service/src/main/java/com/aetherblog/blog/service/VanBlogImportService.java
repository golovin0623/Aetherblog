package com.aetherblog.blog.service;

import com.aetherblog.blog.dto.response.ImportVanBlogResult;
import org.springframework.web.multipart.MultipartFile;

public interface VanBlogImportService {
    ImportVanBlogResult importBackup(MultipartFile file, String mode);
}
