package com.aetherblog.common.core.utils;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Slug 生成工具
 */
public final class SlugUtils {

    private static final Pattern NONLATIN = Pattern.compile("[^\\w-]");
    private static final Pattern WHITESPACE = Pattern.compile("[\\s]");
    private static final Pattern MULTI_DASH = Pattern.compile("-{2,}");

    private SlugUtils() {}

    /**
     * 生成 URL 友好的 slug
     */
    public static String toSlug(String input) {
        if (input == null || input.isBlank()) {
            return "";
        }

        String slug = input.toLowerCase(Locale.ROOT);
        // 处理中文 - 转换为拼音或保留
        slug = Normalizer.normalize(slug, Normalizer.Form.NFD);
        slug = WHITESPACE.matcher(slug).replaceAll("-");
        slug = NONLATIN.matcher(slug).replaceAll("");
        slug = MULTI_DASH.matcher(slug).replaceAll("-");
        slug = slug.replaceAll("^-|-$", "");

        return slug;
    }

    /**
     * 生成唯一 slug（添加时间戳后缀）
     */
    public static String toUniqueSlug(String input) {
        String base = toSlug(input);
        if (base.isEmpty()) {
            base = "post";
        }
        return base + "-" + System.currentTimeMillis() % 100000;
    }
}
