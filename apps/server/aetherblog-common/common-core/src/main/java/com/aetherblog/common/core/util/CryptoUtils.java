package com.aetherblog.common.core.util;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import lombok.extern.slf4j.Slf4j;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * AES 加密解密工具类
 * 用于前后端密码加密传输
 */
@Slf4j
public class CryptoUtils {

    // 必须与前端使用的密钥匹配
    private static final String ENCRYPTION_KEY = "AetherBlog@2026!SecureKey#Auth";
    private static final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 解密前端加密的密码
     * 前端使用 CryptoJS AES 加密
     * 
     * @param encryptedData Base64 编码的 CryptoJS 加密数据
     * @return 解密后的原始密码
     */
    public static String decryptPassword(String encryptedData) {
        try {
            // CryptoJS 格式: "Salted__" + 8 字节 salt + 密文
            byte[] cipherData = Base64.getDecoder().decode(encryptedData);
            
            // 检查 "Salted__" 前缀
            byte[] saltedPrefix = "Salted__".getBytes(StandardCharsets.UTF_8);
            boolean hasSaltedPrefix = true;
            for (int i = 0; i < saltedPrefix.length && i < cipherData.length; i++) {
                if (cipherData[i] != saltedPrefix[i]) {
                    hasSaltedPrefix = false;
                    break;
                }
            }
            
            byte[] salt;
            byte[] ciphertext;
            
            if (hasSaltedPrefix && cipherData.length > 16) {
                // 提取 salt ("Salted__" 后的 8 字节)
                salt = new byte[8];
                System.arraycopy(cipherData, 8, salt, 0, 8);
                
                // 提取密文
                ciphertext = new byte[cipherData.length - 16];
                System.arraycopy(cipherData, 16, ciphertext, 0, cipherData.length - 16);
            } else {
                // 没有 salt 前缀，假设是原始加密数据
                salt = new byte[8];
                ciphertext = cipherData;
            }
            
            // 使用 EVP_BytesToKey 派生密钥和 IV (兼容 OpenSSL)
            byte[][] keyAndIV = evpBytesToKey(32, 16, salt, ENCRYPTION_KEY.getBytes(StandardCharsets.UTF_8));
            byte[] key = keyAndIV[0];
            byte[] iv = keyAndIV[1];
            
            // 解密
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec);
            
            byte[] decrypted = cipher.doFinal(ciphertext);
            String decryptedStr = new String(decrypted, StandardCharsets.UTF_8);
            
            // 解析 JSON 以提取密码
            JsonNode jsonNode = objectMapper.readTree(decryptedStr);
            if (jsonNode.has("password")) {
                return jsonNode.get("password").asText();
            }
            
            return decryptedStr;
        } catch (Exception e) {
            log.error("解密密码失败", e);
            throw new RuntimeException("密码解密失败，请重试");
        }
    }
    
    /**
     * OpenSSL EVP_BytesToKey 实现
     * 用于 CryptoJS 的密钥派生
     */
    private static byte[][] evpBytesToKey(int keyLen, int ivLen, byte[] salt, byte[] password) {
        try {
            byte[] key = new byte[keyLen];
            byte[] iv = new byte[ivLen];
            
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            byte[] lastHash = null;
            int keyOffset = 0;
            int ivOffset = 0;
            
            while (keyOffset < keyLen || ivOffset < ivLen) {
                md.reset();
                if (lastHash != null) {
                    md.update(lastHash);
                }
                md.update(password);
                if (salt != null) {
                    md.update(salt);
                }
                lastHash = md.digest();
                
                // 填充 key
                int toCopy = Math.min(lastHash.length, keyLen - keyOffset);
                if (toCopy > 0) {
                    System.arraycopy(lastHash, 0, key, keyOffset, toCopy);
                    keyOffset += toCopy;
                }
                
                // 填充 IV
                int hashOffset = toCopy;
                toCopy = Math.min(lastHash.length - hashOffset, ivLen - ivOffset);
                if (toCopy > 0) {
                    System.arraycopy(lastHash, hashOffset, iv, ivOffset, toCopy);
                    ivOffset += toCopy;
                }
            }
            
            return new byte[][] { key, iv };
        } catch (Exception e) {
            throw new RuntimeException("Key derivation failed", e);
        }
    }
}
