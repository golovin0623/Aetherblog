package cryptkey

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

// EncryptedPrefix 标记数据已被 Fernet 加密。
// 落库格式: enc:v1:{fernet-token}。读取时按前缀分支:
//   - 有前缀 → 走 Decrypt
//   - 无前缀 → 视作明文(legacy 数据,延迟迁移到下一次 Save 时重写)
//
// 这一设计避免了一次性大批量数据迁移,生产环境只需:
//   1. 设置 AI_CREDENTIAL_ENCRYPTION_KEYS
//   2. 重启 Go 后端
//   3. 任意触发 admin 编辑 / 创建 → 该行从此加密落库
const EncryptedPrefix = "enc:v1:"

// Keystore 是 Fernet 加密的统一入口。Enabled=false 时所有 Encrypt/Decrypt 调用退化为透传。
//
// 设计目标:
//   - 开发/测试环境无需配置 AI_CREDENTIAL_ENCRYPTION_KEYS 也能跑(自动 dev 模式,Encrypt 返回明文)。
//   - 生产环境配了 AI_CREDENTIAL_ENCRYPTION_KEYS 时,新数据写入即加密;legacy 行延迟迁移。
//   - 多 key 轮换:首位用于加密,全部用于解密(MultiFernet 语义)。
type Keystore struct {
	mf      *MultiFernet
	enabled bool
}

// NewKeystoreFromEnv 读取 AI_CREDENTIAL_ENCRYPTION_KEYS 环境变量(逗号分隔多 key)。
// 空 env → 返回 enabled=false 的 Keystore(不加密、不警告,允许开发场景);
// 非空但任一 key 解析失败 → 返回 error,启动应中止。
func NewKeystoreFromEnv() (*Keystore, error) {
	raw := strings.TrimSpace(os.Getenv("AI_CREDENTIAL_ENCRYPTION_KEYS"))
	if raw == "" {
		return &Keystore{enabled: false}, nil
	}
	parts := strings.Split(raw, ",")
	fernets := make([]*Fernet, 0, len(parts))
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		f, err := NewFernet(p)
		if err != nil {
			return nil, fmt.Errorf("AI_CREDENTIAL_ENCRYPTION_KEYS key #%d: %w", i+1, err)
		}
		fernets = append(fernets, f)
	}
	if len(fernets) == 0 {
		return &Keystore{enabled: false}, nil
	}
	mf, err := NewMultiFernet(fernets)
	if err != nil {
		return nil, err
	}
	return &Keystore{mf: mf, enabled: true}, nil
}

// Enabled 报告是否启用了加密。供 startup banner / 健康检查使用。
func (k *Keystore) Enabled() bool { return k.enabled }

// EncryptString 加密明文,返回带 EncryptedPrefix 的存储字符串。
//
// Enabled=false 或入参已经是 enc:v1: 前缀(防双重加密) → 原样返回。
func (k *Keystore) EncryptString(plaintext string) (string, error) {
	if !k.enabled {
		return plaintext, nil
	}
	if strings.HasPrefix(plaintext, EncryptedPrefix) {
		return plaintext, nil
	}
	tok, err := k.mf.Encrypt([]byte(plaintext))
	if err != nil {
		return "", err
	}
	return EncryptedPrefix + tok, nil
}

// DecryptString 把 stored 解码回明文。
//
// 形态:
//   - 带 EncryptedPrefix → 调 MultiFernet.Decrypt
//   - 不带前缀 → legacy 明文,直接返回
//   - Enabled=false 但带前缀 → 错误(运维错配,key 不存在但 DB 里有加密数据)
func (k *Keystore) DecryptString(stored string) (string, error) {
	if !strings.HasPrefix(stored, EncryptedPrefix) {
		return stored, nil
	}
	if !k.enabled {
		return "", errors.New("AI_CREDENTIAL_ENCRYPTION_KEYS is required to decrypt this row")
	}
	pt, err := k.mf.Decrypt(stored[len(EncryptedPrefix):])
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

// IsEncrypted 判断一个字符串是否带 EncryptedPrefix(测试 / 诊断接口用)。
func IsEncrypted(s string) bool { return strings.HasPrefix(s, EncryptedPrefix) }

// --- 单例支持(避免业务层每次 New) ---

var (
	defaultKeystore *Keystore
	defaultOnce     sync.Once
	defaultErr      error
)

// Default 返回进程级单例 Keystore。首次调用从环境读取。
//
// 失败时 (key 解析错) 直接 panic — 这种属于 startup misconfig,不应让业务带病运行。
func Default() *Keystore {
	defaultOnce.Do(func() {
		defaultKeystore, defaultErr = NewKeystoreFromEnv()
	})
	if defaultErr != nil {
		panic(defaultErr)
	}
	return defaultKeystore
}
