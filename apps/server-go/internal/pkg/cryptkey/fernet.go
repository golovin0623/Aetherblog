// Package cryptkey 提供与 Python `cryptography.fernet.Fernet` 二进制兼容的对称加密能力。
//
// 与 ai-service (apps/ai-service/app/services/credential_resolver.py) 共享同一份
// AI_CREDENTIAL_ENCRYPTION_KEYS 环境变量,Go 端落库 / Python 端解密(或反过来) 都可。
//
// Fernet 二进制格式 (RFC 草案):
//   token = base64url(version || timestamp || iv || ciphertext || hmac)
//   version    = 0x80 (1 byte)
//   timestamp  = uint64 big-endian seconds since unix epoch (8 bytes)
//   iv         = 16 bytes
//   ciphertext = AES-128-CBC(encryption_key, iv, PKCS7-pad(plaintext))
//   hmac       = HMAC-SHA256(signing_key, version || timestamp || iv || ciphertext) (32 bytes)
//   key (32B)  = signing_key(16) || encryption_key(16) ── urlsafe-base64 后 44 字符 (含 '=' 填充)
package cryptkey

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"time"
)

const (
	fernetVersion       byte = 0x80
	fernetIVLen              = 16
	fernetHMACLen            = 32
	fernetVersionTSLen       = 1 + 8 // version + timestamp
	fernetMinTokenLen        = fernetVersionTSLen + fernetIVLen + 16 + fernetHMACLen
	fernetSigningKeyLen      = 16
	fernetEncKeyLen          = 16
	fernetTotalKeyLen        = fernetSigningKeyLen + fernetEncKeyLen // 32
)

// ErrInvalidToken 表示 token 校验失败(MAC 不匹配 / padding 非法 / 长度不足等)。
var ErrInvalidToken = errors.New("fernet: invalid token")

// Fernet 是单 key Fernet 加密器。线程安全:Encrypt/Decrypt 内部不持有可变状态。
type Fernet struct {
	signingKey []byte
	encKey     []byte
}

// NewFernet 接收一个 urlsafe-base64 编码的 32 字节密钥(43 或 44 字符均可,自动补 '=' padding),
// 返回可用于加解密的 Fernet 实例。
//
// 兼容 Python `Fernet(key.encode())`:
//   - key 完整形态:44 字符 base64url(含 '=')
//   - shell / .env 复制粘贴常见场景:43 字符(末尾 '=' 被吃)
//   - 都接受
func NewFernet(b64Key string) (*Fernet, error) {
	if b64Key == "" {
		return nil, errors.New("fernet: empty key")
	}
	padded := padBase64URL(b64Key)
	raw, err := base64.URLEncoding.DecodeString(padded)
	if err != nil {
		return nil, fmt.Errorf("fernet: decode key (length=%d): %w", len(b64Key), err)
	}
	if len(raw) != fernetTotalKeyLen {
		return nil, fmt.Errorf("fernet: key must decode to %d bytes, got %d (length=%d chars)", fernetTotalKeyLen, len(raw), len(b64Key))
	}
	return &Fernet{
		signingKey: raw[:fernetSigningKeyLen],
		encKey:     raw[fernetSigningKeyLen:],
	}, nil
}

// Encrypt 加密 plaintext,返回 urlsafe-base64 编码的 token。
func (f *Fernet) Encrypt(plaintext []byte) (string, error) {
	iv := make([]byte, fernetIVLen)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", fmt.Errorf("fernet: random iv: %w", err)
	}
	return f.encryptWithIVAndTime(plaintext, iv, time.Now().Unix())
}

// encryptWithIVAndTime 是 Encrypt 的可注入随机源版本,仅供测试用。
func (f *Fernet) encryptWithIVAndTime(plaintext, iv []byte, ts int64) (string, error) {
	if len(iv) != fernetIVLen {
		return "", fmt.Errorf("fernet: iv must be %d bytes, got %d", fernetIVLen, len(iv))
	}
	block, err := aes.NewCipher(f.encKey)
	if err != nil {
		return "", err
	}
	padded := pkcs7Pad(plaintext, block.BlockSize())
	ciphertext := make([]byte, len(padded))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext, padded)

	header := make([]byte, fernetVersionTSLen+fernetIVLen+len(ciphertext))
	header[0] = fernetVersion
	binary.BigEndian.PutUint64(header[1:9], uint64(ts))
	copy(header[9:9+fernetIVLen], iv)
	copy(header[9+fernetIVLen:], ciphertext)

	mac := hmac.New(sha256.New, f.signingKey)
	mac.Write(header)
	tag := mac.Sum(nil)

	return base64.URLEncoding.EncodeToString(append(header, tag...)), nil
}

// Decrypt 校验并解密 token,返回 plaintext。校验失败统一返回 ErrInvalidToken
// (不暴露具体失败原因,与 Python Fernet 行为对齐)。
func (f *Fernet) Decrypt(token string) ([]byte, error) {
	raw, err := base64.URLEncoding.DecodeString(padBase64URL(token))
	if err != nil {
		return nil, ErrInvalidToken
	}
	if len(raw) < fernetMinTokenLen {
		return nil, ErrInvalidToken
	}
	if raw[0] != fernetVersion {
		return nil, ErrInvalidToken
	}
	headerEnd := len(raw) - fernetHMACLen
	header := raw[:headerEnd]
	tag := raw[headerEnd:]

	mac := hmac.New(sha256.New, f.signingKey)
	mac.Write(header)
	if !hmac.Equal(mac.Sum(nil), tag) {
		return nil, ErrInvalidToken
	}
	iv := raw[9 : 9+fernetIVLen]
	ciphertext := raw[9+fernetIVLen : headerEnd]
	if len(ciphertext)%aes.BlockSize != 0 || len(ciphertext) == 0 {
		return nil, ErrInvalidToken
	}
	block, err := aes.NewCipher(f.encKey)
	if err != nil {
		return nil, ErrInvalidToken
	}
	plaintext := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plaintext, ciphertext)
	return pkcs7Unpad(plaintext, block.BlockSize())
}

// MultiFernet 包装多个 Fernet,Encrypt 用第一个 key,Decrypt 依次尝试每个。
// 与 Python `MultiFernet([f1, f2, ...])` 行为一致,支持零停机轮换。
type MultiFernet struct {
	fernets []*Fernet
}

// NewMultiFernet 用至少一个 fernet 构造。
func NewMultiFernet(fs []*Fernet) (*MultiFernet, error) {
	if len(fs) == 0 {
		return nil, errors.New("fernet: at least one key required")
	}
	return &MultiFernet{fernets: fs}, nil
}

// Encrypt 用第一个 (最新) key 加密。
func (m *MultiFernet) Encrypt(plaintext []byte) (string, error) {
	return m.fernets[0].Encrypt(plaintext)
}

// Decrypt 依次尝试每个 key,任一成功即返回。全部失败返回 ErrInvalidToken。
func (m *MultiFernet) Decrypt(token string) ([]byte, error) {
	for _, f := range m.fernets {
		pt, err := f.Decrypt(token)
		if err == nil {
			return pt, nil
		}
	}
	return nil, ErrInvalidToken
}

// padBase64URL 为 urlsafe-base64 字符串补回缺失的 '=' padding。
//
// shell / .env 复制粘贴 / yaml 解析常常会吃掉末尾 '=' (44 字符 → 43);
// Python 那边 _pad_b64url 做同样的事,这里保持一致让两端共享 key 时无歧义。
func padBase64URL(s string) string {
	if s == "" {
		return s
	}
	rem := len(s) % 4
	if rem == 0 {
		return s
	}
	pad := 4 - rem
	out := make([]byte, len(s)+pad)
	copy(out, s)
	for i := 0; i < pad; i++ {
		out[len(s)+i] = '='
	}
	return string(out)
}

// pkcs7Pad 给 plaintext 加 PKCS#7 padding,使其成为 blockSize 的整数倍。
func pkcs7Pad(b []byte, blockSize int) []byte {
	padLen := blockSize - len(b)%blockSize
	out := make([]byte, len(b)+padLen)
	copy(out, b)
	for i := len(b); i < len(out); i++ {
		out[i] = byte(padLen)
	}
	return out
}

// pkcs7Unpad 移除 PKCS#7 padding 并校验合法性。
func pkcs7Unpad(b []byte, blockSize int) ([]byte, error) {
	if len(b) == 0 || len(b)%blockSize != 0 {
		return nil, ErrInvalidToken
	}
	padLen := int(b[len(b)-1])
	if padLen == 0 || padLen > blockSize || padLen > len(b) {
		return nil, ErrInvalidToken
	}
	for i := len(b) - padLen; i < len(b); i++ {
		if int(b[i]) != padLen {
			return nil, ErrInvalidToken
		}
	}
	return b[:len(b)-padLen], nil
}
