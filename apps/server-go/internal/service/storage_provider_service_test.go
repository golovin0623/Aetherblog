package service

import (
	"context"
	"encoding/json"
	"io"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/pkg/storage"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// Phase 2 的 secret-preserving merge 是个安全敏感的纯函数,这里用单元测试穷举边界。

func TestMergeProviderConfigJSON_KeepsSecretWhenRedacted(t *testing.T) {
	old := `{"bucket":"old-bucket","accessKeyId":"AKIAOLD123456","secretAccessKey":"super-secret-old"}`
	new := `{"bucket":"new-bucket","accessKeyId":"AK****3456","secretAccessKey":"su****-old"}`
	merged, err := mergeProviderConfigJSON(old, new)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(merged), &got); err != nil {
		t.Fatalf("unmarshal merged: %v", err)
	}
	if got["bucket"] != "new-bucket" {
		t.Errorf("bucket should be updated to new-bucket, got %v", got["bucket"])
	}
	if got["accessKeyId"] != "AKIAOLD123456" {
		t.Errorf("accessKeyId should keep old value, got %v", got["accessKeyId"])
	}
	if got["secretAccessKey"] != "super-secret-old" {
		t.Errorf("secretAccessKey should keep old value, got %v", got["secretAccessKey"])
	}
}

func TestMergeProviderConfigJSON_OverwritesWhenNewExplicit(t *testing.T) {
	old := `{"accessKeyId":"AKIAOLD","secretAccessKey":"super-secret-old"}`
	new := `{"accessKeyId":"AKIANEW","secretAccessKey":"super-secret-new"}`
	merged, _ := mergeProviderConfigJSON(old, new)
	if !strings.Contains(merged, "AKIANEW") || !strings.Contains(merged, "super-secret-new") {
		t.Errorf("explicit new secrets should overwrite old ones, got: %s", merged)
	}
}

func TestMergeProviderConfigJSON_KeepsOldWhenEmptyNew(t *testing.T) {
	old := `{"accessKeyId":"AKIAOLD","secretAccessKey":"super-secret-old"}`
	new := `{"accessKeyId":"","secretAccessKey":""}`
	merged, _ := mergeProviderConfigJSON(old, new)
	if !strings.Contains(merged, "AKIAOLD") {
		t.Errorf("empty new value should keep old secret, got: %s", merged)
	}
}

func TestMergeProviderConfigJSON_KeepsOldWhenFieldMissing(t *testing.T) {
	old := `{"accessKeyId":"AKIAOLD","secretAccessKey":"super-secret-old","bucket":"b"}`
	new := `{"bucket":"new"}`
	merged, _ := mergeProviderConfigJSON(old, new)
	var got map[string]any
	json.Unmarshal([]byte(merged), &got)
	if got["accessKeyId"] != "AKIAOLD" {
		t.Errorf("missing field in new should keep old, got: %v", got["accessKeyId"])
	}
	if got["bucket"] != "new" {
		t.Errorf("bucket should be updated, got: %v", got["bucket"])
	}
}

// 批次 2 新增:深合并必须把非 secret 字段(region / endpoint / urlPrefix 等)在前端 partial PUT
// 时从旧值继承。不然 admin 改个 bucket 就会把 region 配置抹掉。
func TestMergeProviderConfigJSON_DeepMergeNonSecretField(t *testing.T) {
	old := `{"bucket":"b","region":"cn-hangzhou","endpoint":"https://oss-cn-hangzhou.aliyuncs.com","accessKeyId":"AKIAOLD","secretAccessKey":"super-secret-old"}`
	// 前端只改 bucket,其他字段未提交
	new := `{"bucket":"new-bucket","accessKeyId":"AK****OLD","secretAccessKey":"su****old"}`
	merged, err := mergeProviderConfigJSON(old, new)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var got map[string]any
	json.Unmarshal([]byte(merged), &got)
	if got["bucket"] != "new-bucket" {
		t.Errorf("bucket should be updated, got: %v", got["bucket"])
	}
	if got["region"] != "cn-hangzhou" {
		t.Errorf("region must be preserved on partial PUT, got: %v", got["region"])
	}
	if got["endpoint"] != "https://oss-cn-hangzhou.aliyuncs.com" {
		t.Errorf("endpoint must be preserved on partial PUT, got: %v", got["endpoint"])
	}
}

// 批次 2 新增:嵌套 map(如 options:{addressingStyle, virtualHost})一层合并 ——
// 前端只改 options.virtualHost,addressingStyle 不能被擦掉。
func TestMergeProviderConfigJSON_DeepMergeNestedOptions(t *testing.T) {
	old := `{"bucket":"b","options":{"addressingStyle":"virtual","virtualHost":"old.example.com"}}`
	new := `{"bucket":"b","options":{"virtualHost":"new.example.com"}}`
	merged, err := mergeProviderConfigJSON(old, new)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var got map[string]any
	json.Unmarshal([]byte(merged), &got)
	opts, ok := got["options"].(map[string]any)
	if !ok {
		t.Fatalf("options not a map: %T", got["options"])
	}
	if opts["addressingStyle"] != "virtual" {
		t.Errorf("nested addressingStyle should be preserved, got: %v", opts["addressingStyle"])
	}
	if opts["virtualHost"] != "new.example.com" {
		t.Errorf("nested virtualHost should be updated, got: %v", opts["virtualHost"])
	}
}

// 批次 2 新增:双方都明确写了同一个非 secret 字段时,新值覆盖。
func TestMergeProviderConfigJSON_OverwriteWhenBothPresent(t *testing.T) {
	old := `{"region":"cn-hangzhou","bucket":"b"}`
	new := `{"region":"cn-shanghai","bucket":"b"}`
	merged, _ := mergeProviderConfigJSON(old, new)
	var got map[string]any
	json.Unmarshal([]byte(merged), &got)
	if got["region"] != "cn-shanghai" {
		t.Errorf("explicit new region should overwrite, got: %v", got["region"])
	}
}

// PR #647 fix:JSON null 应该被当作"缺失"处理,从旧值继承,而不是把旧值覆盖成 nil。
// gemini-code-assist 指出原实现里 null 会让 Unmarshal 落 nil + present=true,绕过缺失分支。
func TestMergeProviderConfigJSON_NullPreservesOldValue(t *testing.T) {
	old := `{"region":"cn-hangzhou","endpoint":"https://oss-cn-hangzhou.aliyuncs.com","bucket":"b"}`
	// 前端显式提交 region:null,文档承诺这等同于"未提",应保留旧值
	new := `{"region":null,"bucket":"new"}`
	merged, err := mergeProviderConfigJSON(old, new)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	var got map[string]any
	json.Unmarshal([]byte(merged), &got)
	if got["region"] != "cn-hangzhou" {
		t.Errorf("explicit null should fall back to old value, got: %v", got["region"])
	}
	if got["endpoint"] != "https://oss-cn-hangzhou.aliyuncs.com" {
		t.Errorf("missing field should be preserved, got: %v", got["endpoint"])
	}
	if got["bucket"] != "new" {
		t.Errorf("explicit non-null new value should overwrite, got: %v", got["bucket"])
	}
}

// PR #647 fix:嵌套对象内的 null 字段同样回退旧值。
func TestMergeProviderConfigJSON_NullInsideNestedOptions(t *testing.T) {
	old := `{"options":{"addressingStyle":"virtual","virtualHost":"old.example.com"}}`
	new := `{"options":{"addressingStyle":null,"virtualHost":"new.example.com"}}`
	merged, _ := mergeProviderConfigJSON(old, new)
	var got map[string]any
	json.Unmarshal([]byte(merged), &got)
	opts, _ := got["options"].(map[string]any)
	if opts["addressingStyle"] != "virtual" {
		t.Errorf("nested null should fall back to old, got: %v", opts["addressingStyle"])
	}
	if opts["virtualHost"] != "new.example.com" {
		t.Errorf("nested non-null should overwrite, got: %v", opts["virtualHost"])
	}
}

func TestIsRedactedValue(t *testing.T) {
	cases := []struct {
		v    string
		want bool
	}{
		{"AB****CD12", true},
		{"****", true},
		{"plaintext_secret", false},
		{"", false},
		{"AKIAIOSFODNN7EXAMPLE", false},
		{"real****secret", false},
		{"AB****CD123", false},
	}
	for _, c := range cases {
		if got := isRedactedValue(c.v); got != c.want {
			t.Errorf("isRedactedValue(%q) = %v, want %v", c.v, got, c.want)
		}
	}
}

func TestRedactProviderConfigJSON_HidesSecrets(t *testing.T) {
	raw := `{"accessKeyId":"AKIAIOSFODNN7EXAMPLE","secretAccessKey":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY","bucket":"mybucket"}`
	red := redactProviderConfigJSON(raw)
	if strings.Contains(red, "AKIAIOSFODNN7EXAMPLE") {
		t.Errorf("redact should hide accessKeyId, got: %s", red)
	}
	if strings.Contains(red, "wJalrXUtnFEMI") {
		t.Errorf("redact should hide secretAccessKey, got: %s", red)
	}
	if !strings.Contains(red, "mybucket") {
		t.Errorf("redact should preserve non-sensitive bucket, got: %s", red)
	}
	if !strings.Contains(red, "****") {
		t.Errorf("redacted output should contain mask marker, got: %s", red)
	}
}

type catalogURLStorage struct{}

func (catalogURLStorage) Upload(context.Context, string, io.Reader, int64, string) (string, error) {
	return "", nil
}

func (catalogURLStorage) Delete(context.Context, string) error {
	return nil
}

func (catalogURLStorage) GetURL(key string) string {
	return "https://data.example.com/aetherBlog/" + strings.TrimLeft(key, "/") + "?imageAetherBlog"
}

func (catalogURLStorage) Type() string {
	return "COS"
}

func (catalogURLStorage) Get(context.Context, string) (io.ReadCloser, int64, string, error) {
	return io.NopCloser(strings.NewReader("")), 0, "", nil
}

func TestStorageProviderServiceLookupCatalogIncludesBackupURL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewStorageProviderRepoWithKeystore(sqlx.NewDb(db, "sqlmock"), nil)
	svc := NewStorageProviderService(repo, nil)
	st := catalogURLStorage{}
	keys := []string{"2026/05/backup.png", "2026/05/native.png"}
	backupURL := st.GetURL(keys[0])
	nativeURL := st.GetURL(keys[1])

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, file_path FROM media_files WHERE storage_provider_id = ? AND file_path IN (?, ?)`)).
		WithArgs(int64(5), keys[0], keys[1]).
		WillReturnRows(sqlmock.NewRows([]string{"id", "file_path"}).AddRow(int64(7), keys[1]))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, backup_url FROM media_files WHERE backup_provider_id = ? AND backup_url IN (?, ?)`)).
		WithArgs(int64(5), backupURL, nativeURL).
		WillReturnRows(sqlmock.NewRows([]string{"id", "backup_url"}).AddRow(int64(42), backupURL))

	got, err := svc.lookupCatalog(context.Background(), 5, keys, st)
	if err != nil {
		t.Fatalf("lookupCatalog: %v", err)
	}
	if got[keys[0]] != 42 {
		t.Fatalf("backup key media id = %d, want 42", got[keys[0]])
	}
	if got[keys[1]] != 7 {
		t.Fatalf("native key media id = %d, want 7", got[keys[1]])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStorageProviderServiceLookupCatalogMatchesHistoricalProviderBackupURL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	repo := repository.NewStorageProviderRepoWithKeystore(sqlx.NewDb(db, "sqlmock"), nil)
	svc := NewStorageProviderService(repo, nil)
	st, err := storage.NewS3Storage(`{
		"bucket":"vanlog-1258312217",
		"region":"ap-shanghai",
		"path":"media/",
		"customUrl":"https://data.golovin.cn",
		"accessKeyId":"k",
		"secretAccessKey":"s"
	}`, "COS")
	if err != nil {
		t.Fatalf("NewS3Storage(COS): %v", err)
	}
	keys := []string{"2026/05/backup.png", "2026/05/native.png"}
	currentBackupURL := "https://data.golovin.cn/media/2026/05/backup.png"
	historicalBackupURL := "https://vanlog-1258312217.cos.ap-shanghai.myqcloud.com/media/2026/05/backup.png"
	currentNativeURL := "https://data.golovin.cn/media/2026/05/native.png"
	historicalNativeURL := "https://vanlog-1258312217.cos.ap-shanghai.myqcloud.com/media/2026/05/native.png"

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, file_path FROM media_files WHERE storage_provider_id = ? AND file_path IN (?, ?)`)).
		WithArgs(int64(5), keys[0], keys[1]).
		WillReturnRows(sqlmock.NewRows([]string{"id", "file_path"}).AddRow(int64(7), keys[1]))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, backup_url FROM media_files WHERE backup_provider_id = ? AND backup_url IN (?, ?, ?, ?)`)).
		WithArgs(int64(5), currentBackupURL, historicalBackupURL, currentNativeURL, historicalNativeURL).
		WillReturnRows(sqlmock.NewRows([]string{"id", "backup_url"}).AddRow(int64(42), historicalBackupURL))

	got, err := svc.lookupCatalog(context.Background(), 5, keys, st)
	if err != nil {
		t.Fatalf("lookupCatalog: %v", err)
	}
	if got[keys[0]] != 42 {
		t.Fatalf("historical backup key media id = %d, want 42", got[keys[0]])
	}
	if got[keys[1]] != 7 {
		t.Fatalf("native key media id = %d, want 7", got[keys[1]])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestFilterListableObjectsDropsDirectoryMarkers(t *testing.T) {
	got := filterListableObjects([]storage.ObjectInfo{
		{Key: "", Size: 0},
		{Key: "/", Size: 1},
		{Key: "2026/05/", Size: 0},
		{Key: "2026/05/photo.png", Size: 0},
		{Key: "2026/05/not-a-marker/", Size: 12},
	})
	wantKeys := []string{"2026/05/photo.png", "2026/05/not-a-marker/"}
	if len(got) != len(wantKeys) {
		t.Fatalf("filtered length = %d, want %d (%v)", len(got), len(wantKeys), got)
	}
	for i, want := range wantKeys {
		if got[i].Key != want {
			t.Fatalf("filtered[%d].Key = %q, want %q", i, got[i].Key, want)
		}
	}
}
