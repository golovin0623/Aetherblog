package com.aetherblog.blog.controller;

import com.aetherblog.blog.dto.response.ImportVanBlogResult;
import com.aetherblog.blog.service.VanBlogImportService;
import com.aetherblog.common.core.domain.R;
import com.aetherblog.common.security.annotation.RateLimit;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "VanBlog 迁移", description = "VanBlog 备份导入与 dry-run")
@RestController
@RequestMapping("/v1/admin/migrations/vanblog")
@RequiredArgsConstructor
public class VanBlogMigrationController {

    private final VanBlogImportService vanBlogImportService;

    @Operation(summary = "导入 VanBlog 备份文件")
    @PostMapping("/import")
    @RateLimit(key = "migration:vanblog", count = 3, time = 3600, limitType = RateLimit.LimitType.USER)
    public R<ImportVanBlogResult> importBackup(
            @RequestPart("file") MultipartFile file,
            @RequestParam(defaultValue = "dry-run") String mode) {
        return R.ok(vanBlogImportService.importBackup(file, mode));
    }
}
