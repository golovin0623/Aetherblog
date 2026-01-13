package com.aetherblog.common.core.util;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * AES 加密解密工具类
 * 用于前后端密码加密传输
 */
@Slf4j
public class CryptoUtils {

    // Must match the key used in frontend
    private static final String ENCRYPTION_KEY = "AetherBlog@2026!SecureKey#Auth";
    private static final ObjectMapper objectMapper = JsonMapper.builder().build();

    /**
     * 解密前端加密的密码
     * 前端使用 CryptoJS AES 加密
     * 
     * @param encryptedData Base64 encoded encrypted data from CryptoJS
     * @return 解密后的原始密码
     */
    public static String decryptPassword(String encryptedData) {
        try {
            // CryptoJS format: "Salted__" + 8 bytes salt + ciphertext
            byte[] cipherData = Base64.getDecoder().decode(encryptedData);
            
            // Check for "Salted__" prefix
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
                // Extract salt (8 bytes after "Salted__")
                salt = new byte[8];
                System.arraycopy(cipherData, 8, salt, 0, 8);
                
                // Extract ciphertext
                ciphertext = new byte[cipherData.length - 16];
                System.arraycopy(cipherData, 16, ciphertext, 0, cipherData.length - 16);
            } else {
                // No salt prefix, assume raw encrypted data
                salt = new byte[8];
                ciphertext = cipherData;
            }
            
            // Derive key and IV using EVP_BytesToKey (OpenSSL compatible)
            byte[][] keyAndIV = evpBytesToKey(32, 16, salt, ENCRYPTION_KEY.getBytes(StandardCharsets.UTF_8));
            byte[] key = keyAndIV[0];
            byte[] iv = keyAndIV[1];
            
            // Decrypt
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec);
            
            byte[] decrypted = cipher.doFinal(ciphertext);
            String decryptedStr = new String(decrypted, StandardCharsets.UTF_8);
            
            // Parse JSON to extract password
            JsonNode jsonNode = objectMapper.readTree(decryptedStr);
            if (jsonNode.has("password")) {
                return jsonNode.get("password").asString();
            }
            
            return decryptedStr;
        } catch (Exception e) {
            log.error("解密密码失败", e);
            throw new RuntimeException("密码解密失败，请重试");
        }
    }
    
    /**
     * OpenSSL EVP_BytesToKey implementation
     * Used by CryptoJS for key derivation
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
                
                // Fill key
                int toCopy = Math.min(lastHash.length, keyLen - keyOffset);
                if (toCopy > 0) {
                    System.arraycopy(lastHash, 0, key, keyOffset, toCopy);
                    keyOffset += toCopy;
                }
                
                // Fill IV
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
