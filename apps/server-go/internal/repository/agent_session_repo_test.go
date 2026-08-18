// agent_session_repo_test.go —— AgentSessionRepo 的**真实 Postgres 集成测试**。
//
// 为什么必须打真库：handler 层用内存 fake store 把整条 SQL 路径替换掉了，
// 二期联调实际炸出来的两个 bug 都只存在于本文件的 SQL 里 ——
//
//	① lib/pq 42P08「inconsistent types deduced」：同一个 $N 既落在 BIGINT
//	   列位又进 to_timestamp() 的 double 上下文，服务端预备语句推不出类型；
//	② 23505：agent_chat_messages 曾用单列 id 主键，而客户端消息 id 只保证
//	   **会话内**唯一，「分支会话」复制消息后两个会话先后同步必撞。
//
// 两者都不可能被 sqlmock / 内存 fake 复现，只有真库能钉住。
//
// 运行方式（CI 无库时自动 t.Skip，不会红）：
//
//	TEST_DATABASE_DSN='postgres://aetherblog:aetherblog123@localhost:5432/aetherblog?sslmode=disable' \
//	  go test ./internal/repository/ -run AgentSession -v
//
// 隔离策略：每个测试用带随机前缀的 id 与独立的临时用户，t.Cleanup 里删用户
// （agent_chat_sessions.user_id 外键 ON DELETE CASCADE，消息随会话级联），
// 绝不触碰既有数据。
package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

// agentSessionTestDSNEnv 是集成测试的开关：未设置即跳过。
const agentSessionTestDSNEnv = "TEST_DATABASE_DSN"

// openAgentSessionTestDB 连库；未配置 DSN 或连不上都 t.Skip —— 集成测试
// 必须「有库时真跑、无库时不红」，否则 CI 会被环境问题绑架。
func openAgentSessionTestDB(t *testing.T) *sqlx.DB {
	t.Helper()
	dsn := os.Getenv(agentSessionTestDSNEnv)
	if dsn == "" {
		t.Skipf("%s 未设置，跳过 AgentSessionRepo 集成测试", agentSessionTestDSNEnv)
	}
	db, err := sqlx.Open("postgres", dsn)
	if err != nil {
		t.Skipf("无法打开 %s：%v", agentSessionTestDSNEnv, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		t.Skipf("无法连接 %s：%v", agentSessionTestDSNEnv, err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// agentSessionTestPrefix 生成本次测试独占的 id 前缀（同时满足
// chk_agent_chat_session_id 的 ^[A-Za-z0-9_-]{8,64}$）。
func agentSessionTestPrefix(t *testing.T) string {
	t.Helper()
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand.Read failed: %v", err)
	}
	return "it_" + hex.EncodeToString(buf)
}

// createAgentSessionTestUser 建临时用户并登记级联清理。
func createAgentSessionTestUser(t *testing.T, db *sqlx.DB, prefix string) int64 {
	t.Helper()
	ctx := context.Background()
	var id int64
	err := db.GetContext(ctx, &id, `
		INSERT INTO users (username, email, password_hash, role, status)
		VALUES ($1, $2, 'x', 'USER', 'ACTIVE')
		RETURNING id`, prefix, prefix+"@example.invalid")
	if err != nil {
		t.Fatalf("创建测试用户失败: %v", err)
	}
	t.Cleanup(func() {
		// users 级联删 agent_chat_sessions，会话再级联删 agent_chat_messages。
		if _, err := db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id); err != nil {
			t.Logf("清理测试用户 %d 失败: %v", id, err)
		}
	})
	return id
}

// newAgentTestSession 构造一个最小合法会话（JSONB 字段带值，覆盖 ::jsonb 绑定）。
func newAgentTestSession(id string, userID int64, updatedAt int64) *model.AgentChatSession {
	params := `{"temperature":0.7}`
	modelID := "gpt-5-mini"
	providerCode := "openai"
	return &model.AgentChatSession{
		ID:              id,
		UserID:          userID,
		Title:           "集成测试会话",
		Mode:            model.AgentSessionModeChat,
		ModelID:         &modelID,
		ProviderCode:    &providerCode,
		ModelParams:     &params,
		Pinned:          false,
		Draft:           "草稿",
		ClientCreatedAt: 1700000000123,
		ClientUpdatedAt: updatedAt,
	}
}

func newAgentTestMessage(id, sessionID string, seq int, role, content string) model.AgentChatMessage {
	payload := `{"think":"…"}`
	return model.AgentChatMessage{
		ID:        id,
		SessionID: sessionID,
		Seq:       seq,
		Role:      role,
		Content:   content,
		Payload:   &payload,
		CreatedAt: 1700000000456,
	}
}

// TestAgentSessionRepo_UpsertRoundTripAndTimestampConversion 钉死 42P08：
// meta upsert 里 client_created_at / client_updated_at 同时出现在 BIGINT 列位
// 与 to_timestamp() 的 double 上下文，必须是**独立参数**，否则 lib/pq 预备
// 语句直接报 "inconsistent types deduced"。顺带断言毫秒 → TIMESTAMPTZ 换算
// 精确（created_at / updated_at 与客户端毫秒一致）。
func TestAgentSessionRepo_UpsertRoundTripAndTimestampConversion(t *testing.T) {
	db := openAgentSessionTestDB(t)
	prefix := agentSessionTestPrefix(t)
	userID := createAgentSessionTestUser(t, db, prefix)
	repo := NewAgentSessionRepo(db)
	ctx := context.Background()

	sessID := prefix + "_s1"
	sess := newAgentTestSession(sessID, userID, 1700000009999)
	msgs := []model.AgentChatMessage{
		newAgentTestMessage(prefix+"_m1", sessID, 0, "user", "你好"),
		newAgentTestMessage(prefix+"_m2", sessID, 1, "assistant", "你好，我是灵境"),
	}
	// ① 新建：这里一旦回归成参数复用就是 42P08。
	if err := repo.Upsert(ctx, sess, msgs); err != nil {
		t.Fatalf("首次 Upsert 失败（42P08 回归？）: %v", err)
	}

	got, gotMsgs, err := repo.GetByIDForUser(ctx, sessID, userID)
	if err != nil {
		t.Fatalf("GetByIDForUser 失败: %v", err)
	}
	if got == nil {
		t.Fatal("GetByIDForUser 返回 nil，期望命中新建会话")
	}
	if got.Title != "集成测试会话" || got.Draft != "草稿" || got.Mode != model.AgentSessionModeChat {
		t.Fatalf("会话 meta 往返不一致: %+v", got)
	}
	if got.ModelParams == nil || *got.ModelParams == "" {
		t.Fatalf("model_params 丢失: %+v", got.ModelParams)
	}
	if got.ClientCreatedAt != sess.ClientCreatedAt || got.ClientUpdatedAt != sess.ClientUpdatedAt {
		t.Fatalf("客户端时间戳往返不一致: created=%d updated=%d", got.ClientCreatedAt, got.ClientUpdatedAt)
	}
	if len(gotMsgs) != 2 || gotMsgs[0].ID != prefix+"_m1" || gotMsgs[1].Seq != 1 {
		t.Fatalf("消息往返不一致: %+v", gotMsgs)
	}

	// created_at / updated_at 必须等于客户端毫秒的精确换算（to_timestamp(ms/1000.0)）。
	var serverTimes struct {
		CreatedAt time.Time `db:"created_at"`
		UpdatedAt time.Time `db:"updated_at"`
	}
	if err := db.GetContext(ctx, &serverTimes, `
		SELECT created_at, updated_at FROM agent_chat_sessions WHERE id = $1`, sessID); err != nil {
		t.Fatalf("读取服务端时间戳失败: %v", err)
	}
	if gotMS := serverTimes.CreatedAt.UnixMilli(); gotMS != sess.ClientCreatedAt {
		t.Fatalf("created_at 毫秒换算错位: got %d, want %d", gotMS, sess.ClientCreatedAt)
	}
	if gotMS := serverTimes.UpdatedAt.UnixMilli(); gotMS != sess.ClientUpdatedAt {
		t.Fatalf("updated_at 毫秒换算错位: got %d, want %d", gotMS, sess.ClientUpdatedAt)
	}

	// ② 更新：同一 id 再写一次（更大的 client_updated_at），走 ON CONFLICT 分支。
	updated := newAgentTestSession(sessID, userID, sess.ClientUpdatedAt+1000)
	updated.Title = "改过标题"
	updated.Pinned = true
	updated.Draft = ""
	newMsgs := []model.AgentChatMessage{
		newAgentTestMessage(prefix+"_m3", sessID, 0, "user", "第二轮"),
	}
	if err := repo.Upsert(ctx, updated, newMsgs); err != nil {
		t.Fatalf("更新 Upsert 失败: %v", err)
	}
	got, gotMsgs, err = repo.GetByIDForUser(ctx, sessID, userID)
	if err != nil || got == nil {
		t.Fatalf("更新后 GetByIDForUser 失败: %v", err)
	}
	if got.Title != "改过标题" || !got.Pinned || got.Draft != "" {
		t.Fatalf("更新未生效: %+v", got)
	}
	if got.ClientUpdatedAt != updated.ClientUpdatedAt {
		t.Fatalf("client_updated_at 未更新: got %d, want %d", got.ClientUpdatedAt, updated.ClientUpdatedAt)
	}
	// 消息是全量替换：旧消息必须消失。
	if len(gotMsgs) != 1 || gotMsgs[0].ID != prefix+"_m3" {
		t.Fatalf("消息未全量替换: %+v", gotMsgs)
	}
	if err := db.GetContext(ctx, &serverTimes, `
		SELECT created_at, updated_at FROM agent_chat_sessions WHERE id = $1`, sessID); err != nil {
		t.Fatalf("读取服务端时间戳失败: %v", err)
	}
	if gotMS := serverTimes.UpdatedAt.UnixMilli(); gotMS != updated.ClientUpdatedAt {
		t.Fatalf("更新后 updated_at 毫秒换算错位: got %d, want %d", gotMS, updated.ClientUpdatedAt)
	}
}

// TestAgentSessionRepo_SameMessageIDAcrossSessions 钉死 23505：
// agent_chat_messages 的主键必须是 (session_id, id) 复合键 —— 「分支会话」
// 把消息连 id 一起复制到新会话，两个会话先后同步时单列全局主键必撞。
func TestAgentSessionRepo_SameMessageIDAcrossSessions(t *testing.T) {
	db := openAgentSessionTestDB(t)
	prefix := agentSessionTestPrefix(t)
	userID := createAgentSessionTestUser(t, db, prefix)
	repo := NewAgentSessionRepo(db)
	ctx := context.Background()

	sharedMsgID := prefix + "_shared"
	originID := prefix + "_orig"
	branchID := prefix + "_brch"

	origin := newAgentTestSession(originID, userID, 1700000001000)
	if err := repo.Upsert(ctx, origin, []model.AgentChatMessage{
		newAgentTestMessage(sharedMsgID, originID, 0, "user", "原始会话首条"),
	}); err != nil {
		t.Fatalf("原始会话 Upsert 失败: %v", err)
	}

	// 分支会话复制同一条消息（同 id，不同 session_id）。
	branch := newAgentTestSession(branchID, userID, 1700000002000)
	if err := repo.Upsert(ctx, branch, []model.AgentChatMessage{
		newAgentTestMessage(sharedMsgID, branchID, 0, "user", "原始会话首条"),
		newAgentTestMessage(prefix+"_bm2", branchID, 1, "assistant", "分支续写"),
	}); err != nil {
		t.Fatalf("分支会话 Upsert 失败（23505 复合主键回归？）: %v", err)
	}

	_, originMsgs, err := repo.GetByIDForUser(ctx, originID, userID)
	if err != nil {
		t.Fatalf("读取原始会话失败: %v", err)
	}
	_, branchMsgs, err := repo.GetByIDForUser(ctx, branchID, userID)
	if err != nil {
		t.Fatalf("读取分支会话失败: %v", err)
	}
	if len(originMsgs) != 1 || originMsgs[0].ID != sharedMsgID {
		t.Fatalf("原始会话消息被污染: %+v", originMsgs)
	}
	if len(branchMsgs) != 2 || branchMsgs[0].ID != sharedMsgID {
		t.Fatalf("分支会话消息不完整: %+v", branchMsgs)
	}
}

// TestAgentSessionRepo_UpsertRejectsStaleClientVersion：LWW 判定。
// 库内 client_updated_at 更新 → ErrAgentSessionConflict；相等视为同一次写的
// 重放，必须放行（幂等）。
func TestAgentSessionRepo_UpsertRejectsStaleClientVersion(t *testing.T) {
	db := openAgentSessionTestDB(t)
	prefix := agentSessionTestPrefix(t)
	userID := createAgentSessionTestUser(t, db, prefix)
	repo := NewAgentSessionRepo(db)
	ctx := context.Background()

	sessID := prefix + "_lww"
	newer := newAgentTestSession(sessID, userID, 1700000005000)
	newer.Title = "服务端较新版本"
	if err := repo.Upsert(ctx, newer, nil); err != nil {
		t.Fatalf("写入较新版本失败: %v", err)
	}

	stale := newAgentTestSession(sessID, userID, 1700000004000)
	stale.Title = "陈旧客户端版本"
	if err := repo.Upsert(ctx, stale, nil); !errors.Is(err, ErrAgentSessionConflict) {
		t.Fatalf("陈旧版本应返回 ErrAgentSessionConflict，got %v", err)
	}
	got, _, err := repo.GetByIDForUser(ctx, sessID, userID)
	if err != nil || got == nil {
		t.Fatalf("冲突后读取失败: %v", err)
	}
	if got.Title != "服务端较新版本" {
		t.Fatalf("冲突写入不该落库，title=%q", got.Title)
	}

	// 时间戳相等 = 同一次写的重放，必须接受。
	replay := newAgentTestSession(sessID, userID, newer.ClientUpdatedAt)
	replay.Title = "服务端较新版本"
	if err := repo.Upsert(ctx, replay, nil); err != nil {
		t.Fatalf("同 client_updated_at 重放应被接受，got %v", err)
	}
}

// TestAgentSessionRepo_UpsertRejectsForeignOwner：会话 id 是客户端生成的
// 全局主键，被他人占用时必须 ErrAgentSessionNotOwned（上层 404，不泄露存在性），
// 且绝不覆盖他人数据。
func TestAgentSessionRepo_UpsertRejectsForeignOwner(t *testing.T) {
	db := openAgentSessionTestDB(t)
	prefix := agentSessionTestPrefix(t)
	ownerID := createAgentSessionTestUser(t, db, prefix+"_a")
	attackerID := createAgentSessionTestUser(t, db, prefix+"_b")
	repo := NewAgentSessionRepo(db)
	ctx := context.Background()

	sessID := prefix + "_own"
	owned := newAgentTestSession(sessID, ownerID, 1700000003000)
	owned.Title = "属于 owner"
	if err := repo.Upsert(ctx, owned, []model.AgentChatMessage{
		newAgentTestMessage(prefix+"_om1", sessID, 0, "user", "owner 的消息"),
	}); err != nil {
		t.Fatalf("owner 写入失败: %v", err)
	}

	// 攻击者用**更大**的 client_updated_at 覆写：必须先撞归属判定。
	hijack := newAgentTestSession(sessID, attackerID, 1700000009000)
	hijack.Title = "被劫持"
	if err := repo.Upsert(ctx, hijack, nil); !errors.Is(err, ErrAgentSessionNotOwned) {
		t.Fatalf("越权 Upsert 应返回 ErrAgentSessionNotOwned，got %v", err)
	}

	got, gotMsgs, err := repo.GetByIDForUser(ctx, sessID, ownerID)
	if err != nil || got == nil {
		t.Fatalf("owner 读取失败: %v", err)
	}
	if got.Title != "属于 owner" || len(gotMsgs) != 1 {
		t.Fatalf("越权写入污染了 owner 数据: title=%q msgs=%d", got.Title, len(gotMsgs))
	}
	// 攻击者视角必须表现为「不存在」。
	other, _, err := repo.GetByIDForUser(ctx, sessID, attackerID)
	if err != nil {
		t.Fatalf("attacker 读取报错: %v", err)
	}
	if other != nil {
		t.Fatalf("attacker 不应看到他人会话: %+v", other)
	}
	// Delete 同样受归属约束。
	deleted, err := repo.Delete(ctx, sessID, attackerID)
	if err != nil {
		t.Fatalf("attacker Delete 报错: %v", err)
	}
	if deleted {
		t.Fatal("attacker 不应删掉他人会话")
	}
}

// TestAgentSessionRepo_UpsertIsIdempotentForSameBody：消息 delete + 全量 insert
// 的幂等性 —— 同一个 body 重放，结果必须逐字段一致（不重复、不丢失、seq 不漂）。
func TestAgentSessionRepo_UpsertIsIdempotentForSameBody(t *testing.T) {
	db := openAgentSessionTestDB(t)
	prefix := agentSessionTestPrefix(t)
	userID := createAgentSessionTestUser(t, db, prefix)
	repo := NewAgentSessionRepo(db)
	ctx := context.Background()

	sessID := prefix + "_idem"
	sess := newAgentTestSession(sessID, userID, 1700000007000)
	msgs := []model.AgentChatMessage{
		newAgentTestMessage(prefix+"_i1", sessID, 0, "user", "一"),
		newAgentTestMessage(prefix+"_i2", sessID, 1, "assistant", "二"),
		newAgentTestMessage(prefix+"_i3", sessID, 2, "user", "三"),
	}

	var first []model.AgentChatMessage
	for round := 0; round < 3; round++ {
		if err := repo.Upsert(ctx, sess, msgs); err != nil {
			t.Fatalf("第 %d 次 Upsert 失败: %v", round+1, err)
		}
		_, got, err := repo.GetByIDForUser(ctx, sessID, userID)
		if err != nil {
			t.Fatalf("第 %d 次读取失败: %v", round+1, err)
		}
		if len(got) != len(msgs) {
			t.Fatalf("第 %d 次消息数漂移: got %d, want %d", round+1, len(got), len(msgs))
		}
		if round == 0 {
			first = got
			continue
		}
		for i := range got {
			if got[i].ID != first[i].ID || got[i].Seq != first[i].Seq ||
				got[i].Content != first[i].Content || got[i].CreatedAt != first[i].CreatedAt {
				t.Fatalf("第 %d 次重放结果不一致: got %+v, want %+v", round+1, got[i], first[i])
			}
		}
	}
}

// TestAgentSessionRepo_ListAndCountByUser：列表聚合（消息数一次算完）与配额
// 计数。也覆盖排序（置顶优先 → updated_at 倒序）与用户隔离。
func TestAgentSessionRepo_ListAndCountByUser(t *testing.T) {
	db := openAgentSessionTestDB(t)
	prefix := agentSessionTestPrefix(t)
	userID := createAgentSessionTestUser(t, db, prefix+"_a")
	otherID := createAgentSessionTestUser(t, db, prefix+"_b")
	repo := NewAgentSessionRepo(db)
	ctx := context.Background()

	if n, err := repo.CountByUser(ctx, userID); err != nil || n != 0 {
		t.Fatalf("初始 CountByUser = %d, err = %v, want 0", n, err)
	}

	// 三条会话：老的 / 新的 / 置顶但最旧。
	old := newAgentTestSession(prefix+"_l1", userID, 1700000001000)
	recent := newAgentTestSession(prefix+"_l2", userID, 1700000003000)
	pinned := newAgentTestSession(prefix+"_l3", userID, 1700000000500)
	pinned.Pinned = true

	if err := repo.Upsert(ctx, old, []model.AgentChatMessage{
		newAgentTestMessage(prefix+"_lm1", old.ID, 0, "user", "a"),
	}); err != nil {
		t.Fatalf("Upsert old 失败: %v", err)
	}
	if err := repo.Upsert(ctx, recent, []model.AgentChatMessage{
		newAgentTestMessage(prefix+"_lm2", recent.ID, 0, "user", "a"),
		newAgentTestMessage(prefix+"_lm3", recent.ID, 1, "assistant", "b"),
	}); err != nil {
		t.Fatalf("Upsert recent 失败: %v", err)
	}
	// pinned 会话故意**不带消息** —— 钉住 LEFT JOIN 的 COALESCE(...,0)：
	// 用 INNER JOIN 聚合会让空会话整行消失。
	if err := repo.Upsert(ctx, pinned, nil); err != nil {
		t.Fatalf("Upsert pinned 失败: %v", err)
	}
	// 他人会话：绝不能出现在列表 / 计数里。
	if err := repo.Upsert(ctx, newAgentTestSession(prefix+"_l4", otherID, 1700000009000), nil); err != nil {
		t.Fatalf("Upsert other 失败: %v", err)
	}

	rows, err := repo.ListByUser(ctx, userID, 100)
	if err != nil {
		t.Fatalf("ListByUser 失败: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("ListByUser 返回 %d 条, want 3: %+v", len(rows), rows)
	}
	// 置顶优先，其余按 updated_at 倒序。
	wantOrder := []string{pinned.ID, recent.ID, old.ID}
	wantCounts := []int64{0, 2, 1}
	for i, row := range rows {
		if row.ID != wantOrder[i] {
			t.Fatalf("第 %d 行 id = %s, want %s（排序回归）", i, row.ID, wantOrder[i])
		}
		if row.MessageCount != wantCounts[i] {
			t.Fatalf("第 %d 行 messageCount = %d, want %d（聚合回归）", i, row.MessageCount, wantCounts[i])
		}
		if row.UserID != userID {
			t.Fatalf("第 %d 行泄露了他人会话: userID = %d", i, row.UserID)
		}
		if row.ModelParams == nil {
			t.Fatalf("第 %d 行 model_params::text 投影丢失", i)
		}
	}

	// limit 生效。
	limited, err := repo.ListByUser(ctx, userID, 2)
	if err != nil {
		t.Fatalf("ListByUser(limit=2) 失败: %v", err)
	}
	if len(limited) != 2 || limited[0].ID != pinned.ID {
		t.Fatalf("limit 未生效: %+v", limited)
	}

	if n, err := repo.CountByUser(ctx, userID); err != nil || n != 3 {
		t.Fatalf("CountByUser = %d, err = %v, want 3", n, err)
	}
	if n, err := repo.CountByUser(ctx, otherID); err != nil || n != 1 {
		t.Fatalf("他人 CountByUser = %d, err = %v, want 1", n, err)
	}

	// Delete 后计数与列表同步收敛，消息级联删除。
	deleted, err := repo.Delete(ctx, recent.ID, userID)
	if err != nil || !deleted {
		t.Fatalf("Delete 失败: deleted=%v err=%v", deleted, err)
	}
	if n, err := repo.CountByUser(ctx, userID); err != nil || n != 2 {
		t.Fatalf("Delete 后 CountByUser = %d, err = %v, want 2", n, err)
	}
	var orphans int
	if err := db.GetContext(ctx, &orphans, `
		SELECT COUNT(*) FROM agent_chat_messages WHERE session_id = $1`, recent.ID); err != nil {
		t.Fatalf("统计孤儿消息失败: %v", err)
	}
	if orphans != 0 {
		t.Fatalf("消息未随会话级联删除，残留 %d 条", orphans)
	}
}
