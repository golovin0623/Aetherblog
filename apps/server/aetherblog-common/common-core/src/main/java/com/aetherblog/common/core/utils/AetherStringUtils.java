package com.aetherblog.common.core.utils;

import org.apache.commons.lang3.StringUtils;

/**
 * 字符串工具类（扩展 Apache Commons）
 */
public class AetherStringUtils {

    private AetherStringUtils() {}

    /**
     * 判断是否为空字符串
     */
    public static boolean isEmpty(String str) {
        return StringUtils.isEmpty(str);
    }

    /**
     * 判断是否不为空
     */
    public static boolean isNotEmpty(String str) {
        return StringUtils.isNotEmpty(str);
    }

    /**
     * 判断是否为空白字符串
     */
    public static boolean isBlank(String str) {
        return StringUtils.isBlank(str);
    }

    /**
     * 判断是否不为空白
     */
    public static boolean isNotBlank(String str) {
        return StringUtils.isNotBlank(str);
    }

    /**
     * 首字母大写
     */
    public static String capitalize(String str) {
        return StringUtils.capitalize(str);
    }

    /**
     * 首字母小写
     */
    public static String uncapitalize(String str) {
        return StringUtils.uncapitalize(str);
    }

    /**
     * 截取字符串
     */
    public static String truncate(String str, int maxWidth) {
        if (str == null) return null;
        if (str.length() <= maxWidth) return str;
        return str.substring(0, maxWidth) + "...";
    }

    /**
     * 驼峰转下划线
     */
    public static String camelToUnderscore(String str) {
        if (str == null) return null;
        return str.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase();
    }

    /**
     * 下划线转驼峰
     */
    public static String underscoreToCamel(String str) {
        if (str == null) return null;
        StringBuilder result = new StringBuilder();
        boolean nextUpperCase = false;
        for (char c : str.toCharArray()) {
            if (c == '_') {
                nextUpperCase = true;
            } else if (nextUpperCase) {
                result.append(Character.toUpperCase(c));
                nextUpperCase = false;
            } else {
                result.append(c);
            }
        }
        return result.toString();
    }
}
