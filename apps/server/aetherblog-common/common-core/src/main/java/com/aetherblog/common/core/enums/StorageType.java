package com.aetherblog.common.core.enums;

/**
 * 存储类型枚举
 */
public enum StorageType {

    LOCAL("local", "本地存储"),
    OSS("oss", "阿里云OSS"),
    COS("cos", "腾讯云COS"),
    MINIO("minio", "MinIO"),
    S3("s3", "AWS S3");

    private final String code;
    private final String desc;

    StorageType(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }

    public String getCode() {
        return code;
    }

    public String getDesc() {
        return desc;
    }

    public static StorageType fromCode(String code) {
        for (StorageType type : values()) {
            if (type.code.equals(code)) {
                return type;
            }
        }
        return LOCAL;
    }
}
