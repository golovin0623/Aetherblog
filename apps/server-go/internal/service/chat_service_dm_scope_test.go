package service

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// stubSettings 以固定值/错误实现 ChatSettingReader。
type stubSettings struct {
	val string
	err error
}

func (s stubSettings) GetValue(context.Context, string) (string, error) { return s.val, s.err }

func newChatServiceMock(t *testing.T) (*ChatService, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	sx := sqlx.NewDb(db, "sqlmock")
	svc := NewChatService(repository.NewChatRepo(sx), repository.NewUserRepo(sx))
	return svc, mock, func() { _ = db.Close() }
}

func TestDMScopeFallback(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name     string
		settings ChatSettingReader
		want     string
	}{
		{"未注入配置读取器回退 any", nil, DMScopeAny},
		{"配置为 team", stubSettings{val: "team"}, DMScopeTeam},
		{"大小写与空白宽容", stubSettings{val: "  TEAM "}, DMScopeTeam},
		{"非法值回退 any", stubSettings{val: "friends"}, DMScopeAny},
		{"读取失败回退 any", stubSettings{err: errors.New("db down")}, DMScopeAny},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &ChatService{settings: tc.settings}
			if got := svc.dmScope(ctx); got != tc.want {
				t.Fatalf("dmScope = %q, want %q", got, tc.want)
			}
		})
	}
}

// userRow 构造 FindByID 需要的最小 users 行。
func userRow() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "username", "email", "password_hash", "role", "status", "must_change_password"}).
		AddRow(int64(42), "bob", "bob@x.io", "hash", "USER", "ACTIVE", false)
}

// TestOpenDirectTeamScopeDenied：scope=team 且非管理员、无共享团队 → ErrChatBadTarget，
// 且不得触达 FindOrCreateDirect（拒绝语义与「用户不存在」不可区分）。
func TestOpenDirectTeamScopeDenied(t *testing.T) {
	svc, mock, cleanup := newChatServiceMock(t)
	defer cleanup()
	svc.AttachSettings(stubSettings{val: "team"})

	mock.ExpectQuery(`SELECT \* FROM users WHERE id =`).WillReturnRows(userRow())
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM team_members ta`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	_, err := svc.OpenDirect(context.Background(), 1, 42, false)
	if !errors.Is(err, ErrChatBadTarget) {
		t.Fatalf("err = %v, want ErrChatBadTarget", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

// TestOpenDirectTeamScopeSharedTeamPasses：有共享团队时放行到会话创建
// （用 FindOrCreateDirect 的注入错误证明已通过策略门）。
func TestOpenDirectTeamScopeSharedTeamPasses(t *testing.T) {
	svc, mock, cleanup := newChatServiceMock(t)
	defer cleanup()
	svc.AttachSettings(stubSettings{val: "team"})

	sentinel := errors.New("reached FindOrCreateDirect")
	mock.ExpectQuery(`SELECT \* FROM users WHERE id =`).WillReturnRows(userRow())
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM team_members ta`).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT \* FROM chat_conversations WHERE kind='DIRECT'`).WillReturnError(sentinel)

	_, err := svc.OpenDirect(context.Background(), 1, 42, false)
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want sentinel（应已越过策略门）", err)
	}
}

// TestOpenDirectTeamScopeAdminBypass：管理员在 scope=team 下不做共享团队检查。
func TestOpenDirectTeamScopeAdminBypass(t *testing.T) {
	svc, mock, cleanup := newChatServiceMock(t)
	defer cleanup()
	svc.AttachSettings(stubSettings{val: "team"})

	sentinel := errors.New("reached FindOrCreateDirect")
	mock.ExpectQuery(`SELECT \* FROM users WHERE id =`).WillReturnRows(userRow())
	// 注意：不 Expect team_members 查询 —— 管理员直接跳过。
	mock.ExpectQuery(`SELECT \* FROM chat_conversations WHERE kind='DIRECT'`).WillReturnError(sentinel)

	_, err := svc.OpenDirect(context.Background(), 1, 42, true)
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want sentinel", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

// TestSearchDMTargetsEmptyQuery：空查询不触库、返回空列表（不做全量目录 dump）。
func TestSearchDMTargetsEmptyQuery(t *testing.T) {
	svc, mock, cleanup := newChatServiceMock(t)
	defer cleanup()
	svc.AttachSettings(stubSettings{val: "any"})

	got, err := svc.SearchDMTargets(context.Background(), 1, false, "   ")
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v, %v; want 空列表且无错误", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

// TestSearchDMTargetsScopeSQL：scope=team 非管理员的搜索 SQL 必须带共享团队 EXISTS 子句；
// scope=any 则不带 —— 保证「搜得到 ⇔ 打得开」同源。
func TestSearchDMTargetsScopeSQL(t *testing.T) {
	t.Run("team 范围带 EXISTS", func(t *testing.T) {
		svc, mock, cleanup := newChatServiceMock(t)
		defer cleanup()
		svc.AttachSettings(stubSettings{val: "team"})
		mock.ExpectQuery(`FROM users u[\s\S]*EXISTS\(\s*SELECT 1 FROM team_members ta`).
			WillReturnRows(sqlmock.NewRows([]string{"user_id", "username", "nickname", "avatar"}))
		if _, err := svc.SearchDMTargets(context.Background(), 1, false, "bo"); err != nil {
			t.Fatalf("err = %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("expectations: %v", err)
		}
	})
	t.Run("any 范围不带 EXISTS", func(t *testing.T) {
		svc, mock, cleanup := newChatServiceMock(t)
		defer cleanup()
		svc.AttachSettings(stubSettings{val: "any"})
		mock.ExpectQuery(`FROM users u`).
			WillReturnRows(sqlmock.NewRows([]string{"user_id", "username", "nickname", "avatar"}).
				AddRow(int64(7), "amy", nil, nil))
		got, err := svc.SearchDMTargets(context.Background(), 1, false, "am")
		if err != nil || len(got) != 1 || got[0].UserID != 7 {
			t.Fatalf("got %v, %v", got, err)
		}
	})
}
