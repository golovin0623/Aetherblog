package com.aetherblog.common.core.enums;

/**
 * 通用状态枚举
 */
public enum StatusEnum {

    DISABLED(0, "禁用"),
    ENABLED(1, "启用");

    private final int code;
    private final String desc;

    StatusEnum(int code, String desc) {
        this.code = code;
        this.desc = desc;
    }

    public int getCode() {
        return code;
    }

    public String getDesc() {
        return desc;
    }

    public static StatusEnum fromCode(int code) {
        for (StatusEnum status : values()) {
            if (status.code == code) {
                return status;
            }
        }
        return null;
    }
}
