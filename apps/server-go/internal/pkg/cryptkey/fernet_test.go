package cryptkey

import (
	"strings"
	"testing"
)

// TestFernet_RoundTrip 基本加解密往返。
func TestFernet_RoundTrip(t *testing.T) {
	// 用一个固定的 32B 密钥(全 0)的 base64url 形态测试,避免随机依赖
	// Python: base64.urlsafe_b64encode(b'\0' * 32).decode() == 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
	const key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	f, err := NewFernet(key)
	if err != nil {
		t.Fatalf("NewFernet: %v", err)
	}
	cases := []string{
		"",
		"hello world",
		"AKIAIOSFODNN7EXAMPLE",
		`{"bucket":"my-bucket","secretAccessKey":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"}`,
		strings.Repeat("a", 1000),
	}
	for _, plain := range cases {
		tok, err := f.Encrypt([]byte(plain))
		if err != nil {
			t.Fatalf("encrypt %q: %v", plain, err)
		}
		dec, err := f.Decrypt(tok)
		if err != nil {
			t.Fatalf("decrypt %q: %v", plain, err)
		}
		if string(dec) != plain {
			t.Errorf("roundtrip mismatch: got %q want %q", dec, plain)
		}
	}
}

// TestFernet_TamperedTokenRejected 篡改 token 必须被 MAC 校验拦下。
func TestFernet_TamperedTokenRejected(t *testing.T) {
	f, _ := NewFernet("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	tok, _ := f.Encrypt([]byte("secret"))

	// 翻 token 中间任意一个字符
	if len(tok) < 30 {
		t.Fatal("test token too short")
	}
	tampered := tok[:20] + flipChar(tok[20]) + tok[21:]
	if _, err := f.Decrypt(tampered); err != ErrInvalidToken {
		t.Errorf("tampered token should be rejected, got err=%v", err)
	}
}

// TestFernet_KeyPaddingTolerance 43 字符无 '=' 与 44 字符带 '=' 必须等价。
func TestFernet_KeyPaddingTolerance(t *testing.T) {
	full := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	stripped := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	f1, _ := NewFernet(full)
	f2, err := NewFernet(stripped)
	if err != nil {
		t.Fatalf("stripped key should be accepted: %v", err)
	}
	tok, _ := f1.Encrypt([]byte("hello"))
	pt, err := f2.Decrypt(tok)
	if err != nil || string(pt) != "hello" {
		t.Errorf("padding-tolerant keys should be interchangeable")
	}
}

// TestMultiFernet_RotationDecrypt 老 key 加密的 token 应该用新 keystore 还能解。
func TestMultiFernet_RotationDecrypt(t *testing.T) {
	oldKey := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
	newKey := "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA="
	oldF, _ := NewFernet(oldKey)
	newF, _ := NewFernet(newKey)

	// 老 key 加密
	tok, _ := oldF.Encrypt([]byte("rotation"))

	// 新 keystore 仅有 newF — 应该解密失败
	mfNewOnly, _ := NewMultiFernet([]*Fernet{newF})
	if _, err := mfNewOnly.Decrypt(tok); err != ErrInvalidToken {
		t.Errorf("new-key-only should not decrypt old token, got %v", err)
	}

	// 新 keystore 包含 [newF, oldF] — 应该解密成功
	mfRotation, _ := NewMultiFernet([]*Fernet{newF, oldF})
	pt, err := mfRotation.Decrypt(tok)
	if err != nil || string(pt) != "rotation" {
		t.Errorf("rotation keystore should decrypt: pt=%q err=%v", pt, err)
	}

	// 新 keystore 加密用 newF (第一个),老 keystore 自然解不开
	tok2, _ := mfRotation.Encrypt([]byte("with new"))
	if _, err := oldF.Decrypt(tok2); err != ErrInvalidToken {
		t.Errorf("old-only should not decrypt new-encrypted token")
	}
}

// TestKeystore_DisabledIsTransparent 没配 env 时 Encrypt/Decrypt 透传。
func TestKeystore_DisabledIsTransparent(t *testing.T) {
	t.Setenv("AI_CREDENTIAL_ENCRYPTION_KEYS", "")
	ks, err := NewKeystoreFromEnv()
	if err != nil {
		t.Fatalf("env empty should succeed: %v", err)
	}
	if ks.Enabled() {
		t.Error("Enabled should be false when env is empty")
	}
	got, err := ks.EncryptString("plain")
	if err != nil || got != "plain" {
		t.Errorf("disabled EncryptString should be transparent, got %q err=%v", got, err)
	}
	got2, err := ks.DecryptString("plain")
	if err != nil || got2 != "plain" {
		t.Errorf("disabled DecryptString should be transparent, got %q err=%v", got2, err)
	}
}

// TestKeystore_EnabledRoundTrip 正常加密往返,带 enc:v1: 前缀。
func TestKeystore_EnabledRoundTrip(t *testing.T) {
	t.Setenv("AI_CREDENTIAL_ENCRYPTION_KEYS", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	ks, err := NewKeystoreFromEnv()
	if err != nil {
		t.Fatalf("NewKeystoreFromEnv: %v", err)
	}
	if !ks.Enabled() {
		t.Fatal("should be enabled")
	}
	stored, err := ks.EncryptString("super-secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !strings.HasPrefix(stored, EncryptedPrefix) {
		t.Errorf("stored value should start with %q, got %q", EncryptedPrefix, stored)
	}
	plain, err := ks.DecryptString(stored)
	if err != nil || plain != "super-secret" {
		t.Errorf("roundtrip: pt=%q err=%v", plain, err)
	}
}

// TestKeystore_LegacyPlaintextStillReadable 没带前缀的 legacy 行不走加密路径。
func TestKeystore_LegacyPlaintextStillReadable(t *testing.T) {
	t.Setenv("AI_CREDENTIAL_ENCRYPTION_KEYS", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	ks, _ := NewKeystoreFromEnv()
	got, err := ks.DecryptString(`{"bucket":"legacy"}`)
	if err != nil || got != `{"bucket":"legacy"}` {
		t.Errorf("legacy plaintext should be returned as-is, got %q err=%v", got, err)
	}
}

// TestKeystore_DoubleEncryptIdempotent 已加密的字符串再次 EncryptString 不应该套两层。
func TestKeystore_DoubleEncryptIdempotent(t *testing.T) {
	t.Setenv("AI_CREDENTIAL_ENCRYPTION_KEYS", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	ks, _ := NewKeystoreFromEnv()
	once, _ := ks.EncryptString("x")
	twice, _ := ks.EncryptString(once)
	if twice != once {
		t.Errorf("double encrypt should be idempotent")
	}
}

// TestKeystore_BadKeyAtStartup 错误 key 应该让 startup 失败。
func TestKeystore_BadKeyAtStartup(t *testing.T) {
	t.Setenv("AI_CREDENTIAL_ENCRYPTION_KEYS", "not-a-valid-fernet-key")
	if _, err := NewKeystoreFromEnv(); err == nil {
		t.Error("invalid key should produce error at NewKeystoreFromEnv")
	}
}

func flipChar(c byte) string {
	if c == 'A' {
		return "B"
	}
	return "A"
}

// TestFernet_PythonCompatibility 用 Python cryptography.fernet 生成的 token 在 Go 端必须解开。
//
// 该 token 由以下命令生成 (key=base64.urlsafe_b64encode(b'\0'*32)):
//
//	python3 -c "from cryptography.fernet import Fernet; k=b'AAAA...A=' ; print(Fernet(k).encrypt(b'cross-language compat test').decode())"
//
// 注意:Fernet token 本身含 unix timestamp 和随机 IV,所以这里写死的是某次具体运行的输出,
// 但只要 key 一样,任何时候 Go 端调 Decrypt 都该返回原始 plaintext。
func TestFernet_PythonCompatibility(t *testing.T) {
	const (
		key      = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
		pyToken  = "gAAAAABp9j2JdJaAN4lPTMvulnZ5DdeZtWeBPClEQ9uQoAV64UO7iE0tE5ROq_Yra1rg7ML7BzxAkAXvy6qa75IV6Gxe0E0KXZuerdqXVPTOTxrhBnhIUa8="
		expected = "cross-language compat test"
	)
	f, err := NewFernet(key)
	if err != nil {
		t.Fatalf("NewFernet: %v", err)
	}
	pt, err := f.Decrypt(pyToken)
	if err != nil {
		t.Fatalf("decrypt python token: %v", err)
	}
	if string(pt) != expected {
		t.Errorf("python compat: got %q want %q", pt, expected)
	}
}
