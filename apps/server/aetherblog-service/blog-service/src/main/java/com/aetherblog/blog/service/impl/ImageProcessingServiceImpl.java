package com.aetherblog.blog.service.impl;

import com.aetherblog.blog.entity.MediaFile;
import com.aetherblog.blog.entity.MediaVariant;
import com.aetherblog.blog.entity.MediaVariant.VariantType;
import com.aetherblog.blog.repository.MediaVariantRepository;
import com.aetherblog.blog.service.ImageProcessingService;
import com.aetherblog.common.core.exception.BusinessException;
import com.drew.imaging.ImageMetadataReader;
import com.drew.metadata.Directory;
import com.drew.metadata.Metadata;
import com.drew.metadata.Tag;
import io.trbl.blurhash.BlurHash;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.coobird.thumbnailator.Thumbnails;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.CompletableFuture;

/**
 * 图像处理服务实现
 *
 * @ref 媒体库深度优化方案 - Phase 4: 图像处理
 * @author AI Assistant
 * @since 2.4.0
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ImageProcessingServiceImpl implements ImageProcessingService {

    private final MediaVariantRepository variantRepository;

    @Value("${aetherblog.upload.path:./uploads}")
    private String uploadBasePath;

    @Value("${aetherblog.upload.url-prefix:/uploads}")
    private String uploadUrlPrefix;

    // 预设尺寸
    private static final Map<VariantType, int[]> PRESET_SIZES = Map.of(
            VariantType.THUMBNAIL, new int[]{150, 150},
            VariantType.SMALL, new int[]{400, 400},
            VariantType.MEDIUM, new int[]{800, 800},
            VariantType.LARGE, new int[]{1600, 1600}
    );

    @Override
    @Transactional
    public MediaVariant generateThumbnail(MediaFile file, int width, int height) {
        Objects.requireNonNull(file, "媒体文件不能为空");

        if (!file.getFileType().equals(MediaFile.FileType.IMAGE)) {
            throw new BusinessException(400, "只能为图片生成缩略图");
        }

        try {
            Path sourcePath = Paths.get(uploadBasePath, file.getFilePath());
            if (!Files.exists(sourcePath)) {
                throw new BusinessException(404, "源文件不存在: " + file.getFilePath());
            }

            // 生成变体文件名
            String extension = getFileExtension(file.getFilename());
            String variantFilename = generateVariantFilename(file.getFilename(), width, height);
            String variantRelativePath = getVariantPath(file.getFilePath(), variantFilename);

            // 创建目录
            Path variantPath = Paths.get(uploadBasePath, variantRelativePath);
            Files.createDirectories(variantPath.getParent());

            // 生成缩略图
            BufferedImage thumbnail = Thumbnails.of(sourcePath.toFile())
                    .size(width, height)
                    .asBufferedImage();

            ImageIO.write(thumbnail, extension, variantPath.toFile());

            // 创建变体实体
            MediaVariant variant = new MediaVariant();
            variant.setMediaFile(file);
            variant.setVariantType(determineVariantType(width, height));
            variant.setFilePath(variantRelativePath);
            variant.setFileUrl(uploadUrlPrefix + "/" + variantRelativePath);
            variant.setFileSize(Files.size(variantPath));
            variant.setWidth(thumbnail.getWidth());
            variant.setHeight(thumbnail.getHeight());
            variant.setFormat(extension);
            variant.setQuality(85);

            MediaVariant saved = variantRepository.save(variant);
            log.info("生成缩略图: fileId={}, size={}x{}, path={}",
                    file.getId(), width, height, variantRelativePath);
            return saved;

        } catch (IOException e) {
            log.error("生成缩略图失败: fileId={}", file.getId(), e);
            throw new BusinessException(500, "生成缩略图失败: " + e.getMessage());
        }
    }

    @Override
    @Async
    @Transactional
    public CompletableFuture<List<MediaVariant>> generateAllVariantsAsync(MediaFile file) {
        Objects.requireNonNull(file, "媒体文件不能为空");

        if (!file.getFileType().equals(MediaFile.FileType.IMAGE)) {
            return CompletableFuture.completedFuture(Collections.emptyList());
        }

        List<MediaVariant> variants = new ArrayList<>();

        try {
            // 生成所有预设尺寸
            for (Map.Entry<VariantType, int[]> entry : PRESET_SIZES.entrySet()) {
                int[] size = entry.getValue();
                try {
                    MediaVariant variant = generateThumbnail(file, size[0], size[1]);
                    variants.add(variant);
                } catch (Exception e) {
                    log.warn("生成变体失败: fileId={}, type={}", file.getId(), entry.getKey(), e);
                }
            }

            // 生成WebP格式
            try {
                MediaVariant webp = convertFormat(file, "webp", 85);
                variants.add(webp);
            } catch (Exception e) {
                log.warn("生成WebP失败: fileId={}", file.getId(), e);
            }

            log.info("异步生成所有变体完成: fileId={}, count={}", file.getId(), variants.size());
            return CompletableFuture.completedFuture(variants);

        } catch (Exception e) {
            log.error("异步生成变体失败: fileId={}", file.getId(), e);
            return CompletableFuture.completedFuture(variants);
        }
    }

    @Override
    @Transactional
    public MediaVariant convertFormat(MediaFile file, String format, int quality) {
        Objects.requireNonNull(file, "媒体文件不能为空");
        Objects.requireNonNull(format, "目标格式不能为空");

        if (!file.getFileType().equals(MediaFile.FileType.IMAGE)) {
            throw new BusinessException(400, "只能转换图片格式");
        }

        try {
            Path sourcePath = Paths.get(uploadBasePath, file.getFilePath());
            if (!Files.exists(sourcePath)) {
                throw new BusinessException(404, "源文件不存在: " + file.getFilePath());
            }

            // 生成变体文件名
            String variantFilename = generateFormatVariantFilename(file.getFilename(), format);
            String variantRelativePath = getVariantPath(file.getFilePath(), variantFilename);

            // 创建目录
            Path variantPath = Paths.get(uploadBasePath, variantRelativePath);
            Files.createDirectories(variantPath.getParent());

            // 格式转换
            BufferedImage image = ImageIO.read(sourcePath.toFile());
            Thumbnails.of(image)
                    .scale(1.0)
                    .outputFormat(format)
                    .outputQuality(quality / 100.0)
                    .toFile(variantPath.toFile());

            // 创建变体实体
            MediaVariant variant = new MediaVariant();
            variant.setMediaFile(file);
            variant.setVariantType(format.equalsIgnoreCase("webp") ? VariantType.WEBP :
                                  format.equalsIgnoreCase("avif") ? VariantType.AVIF : VariantType.ORIGINAL);
            variant.setFilePath(variantRelativePath);
            variant.setFileUrl(uploadUrlPrefix + "/" + variantRelativePath);
            variant.setFileSize(Files.size(variantPath));
            variant.setWidth(image.getWidth());
            variant.setHeight(image.getHeight());
            variant.setFormat(format);
            variant.setQuality(quality);

            MediaVariant saved = variantRepository.save(variant);
            log.info("格式转换: fileId={}, format={}, quality={}", file.getId(), format, quality);
            return saved;

        } catch (IOException e) {
            log.error("格式转换失败: fileId={}, format={}", file.getId(), format, e);
            throw new BusinessException(500, "格式转换失败: " + e.getMessage());
        }
    }

    @Override
    @Transactional
    public MediaVariant optimize(MediaFile file, int targetSizeKB) {
        Objects.requireNonNull(file, "媒体文件不能为空");

        if (!file.getFileType().equals(MediaFile.FileType.IMAGE)) {
            throw new BusinessException(400, "只能优化图片");
        }

        // 简单实现: 逐步降低质量直到达到目标大小
        int quality = 90;
        MediaVariant result = null;

        while (quality >= 50) {
            result = convertFormat(file, "jpg", quality);
            if (result.getFileSize() <= targetSizeKB * 1024) {
                break;
            }
            quality -= 10;
        }

        return result;
    }

    @Override
    public Map<String, Object> extractExif(MediaFile file) {
        Objects.requireNonNull(file, "媒体文件不能为空");

        if (!file.getFileType().equals(MediaFile.FileType.IMAGE)) {
            return Collections.emptyMap();
        }

        try {
            Path filePath = Paths.get(uploadBasePath, file.getFilePath());
            if (!Files.exists(filePath)) {
                throw new BusinessException(404, "文件不存在: " + file.getFilePath());
            }

            Metadata metadata = ImageMetadataReader.readMetadata(filePath.toFile());
            Map<String, Object> exifData = new HashMap<>();

            for (Directory directory : metadata.getDirectories()) {
                for (Tag tag : directory.getTags()) {
                    exifData.put(tag.getTagName(), tag.getDescription());
                }
            }

            log.info("提取EXIF数据: fileId={}, tags={}", file.getId(), exifData.size());
            return exifData;

        } catch (Exception e) {
            log.error("EXIF提取失败: fileId={}", file.getId(), e);
            return Collections.emptyMap();
        }
    }

    @Override
    public String generateBlurhash(MediaFile file) {
        Objects.requireNonNull(file, "媒体文件不能为空");

        if (!file.getFileType().equals(MediaFile.FileType.IMAGE)) {
            return null;
        }

        try {
            Path filePath = Paths.get(uploadBasePath, file.getFilePath());
            if (!Files.exists(filePath)) {
                throw new BusinessException(404, "文件不存在: " + file.getFilePath());
            }

            BufferedImage image = ImageIO.read(filePath.toFile());
            if (image == null) {
                return null;
            }

            // 缩小图片以加快Blurhash计算
            BufferedImage smallImage = Thumbnails.of(image)
                    .size(100, 100)
                    .asBufferedImage();

            // 生成Blurhash (4x3组件)
            String blurhash = BlurHash.encode(smallImage, 4, 3);

            log.info("生成Blurhash: fileId={}, hash={}", file.getId(), blurhash);
            return blurhash;

        } catch (Exception e) {
            log.error("Blurhash生成失败: fileId={}", file.getId(), e);
            return null;
        }
    }

    @Override
    public List<MediaVariant> getVariants(Long fileId) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        return variantRepository.findByMediaFileId(fileId);
    }

    @Override
    public MediaVariant getVariant(Long fileId, VariantType variantType) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        Objects.requireNonNull(variantType, "变体类型不能为空");
        return variantRepository.findByMediaFileIdAndVariantType(fileId, variantType)
                .orElseThrow(() -> new BusinessException(404, "变体不存在"));
    }

    @Override
    @Transactional
    public void deleteVariants(Long fileId) {
        Objects.requireNonNull(fileId, "文件ID不能为空");
        List<MediaVariant> variants = variantRepository.findByMediaFileId(fileId);

        // 删除物理文件
        for (MediaVariant variant : variants) {
            try {
                Path path = Paths.get(uploadBasePath, variant.getFilePath());
                Files.deleteIfExists(path);
            } catch (IOException e) {
                log.warn("删除变体文件失败: path={}", variant.getFilePath(), e);
            }
        }

        // 删除数据库记录
        variantRepository.deleteByMediaFileId(fileId);
        log.info("删除所有变体: fileId={}, count={}", fileId, variants.size());
    }

    // ========== 辅助方法 ==========

    private String getFileExtension(String filename) {
        if (filename == null) return "jpg";
        int dotIndex = filename.lastIndexOf('.');
        return dotIndex > 0 ? filename.substring(dotIndex + 1).toLowerCase() : "jpg";
    }

    private String generateVariantFilename(String originalFilename, int width, int height) {
        String nameWithoutExt = originalFilename.substring(0, originalFilename.lastIndexOf('.'));
        String extension = getFileExtension(originalFilename);
        return nameWithoutExt + "_" + width + "x" + height + "." + extension;
    }

    private String generateFormatVariantFilename(String originalFilename, String format) {
        String nameWithoutExt = originalFilename.substring(0, originalFilename.lastIndexOf('.'));
        return nameWithoutExt + "." + format;
    }

    private String getVariantPath(String originalPath, String variantFilename) {
        Path original = Paths.get(originalPath);
        Path parent = original.getParent();
        return parent != null ? parent.resolve(variantFilename).toString() : variantFilename;
    }

    private VariantType determineVariantType(int width, int height) {
        if (width <= 150 && height <= 150) return VariantType.THUMBNAIL;
        if (width <= 400 && height <= 400) return VariantType.SMALL;
        if (width <= 800 && height <= 800) return VariantType.MEDIUM;
        if (width <= 1600 && height <= 1600) return VariantType.LARGE;
        return VariantType.ORIGINAL;
    }
}
