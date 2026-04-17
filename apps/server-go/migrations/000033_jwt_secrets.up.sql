-- Migration 000033: jwt_secrets registry for scheduled JWT signing key rotation.
--
-- 背景：VULN-152 的历史 commit 已把一次性 admin JWT 写进 git；即便此次 PR
-- 已经轮换 JWT_SECRET 一次，只要签名密钥以环境变量方式静态分发，再次泄露只是
-- 时间问题。本表把签名密钥提升为"数据库管理的、支持定时轮换 + 双 key 重叠
-- 验证"的资源：
--   * status='current'  —— 用于新 token 签名，同时是验证候选；
--   * status='previous' —— 不再签名，但在 grace window 内继续通过验证，
--                          让已发放的 access_token 在 token TTL 内不掉线；
--   * status='retired'  —— 完全失效，仅供审计追溯。
--
-- 每种 active 状态最多一行（部分唯一索引保证），rotator 在单实例/多实例模式
-- 下都能安全地做"demote current → promote new"的 CAS 事务。
CREATE TABLE IF NOT EXISTS jwt_secrets (
    id            BIGSERIAL PRIMARY KEY,
    secret_value  TEXT NOT NULL,
    status        VARCHAR(16) NOT NULL CHECK (status IN ('current', 'previous', 'retired')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_at   TIMESTAMPTZ,
    demoted_at    TIMESTAMPTZ,
    retired_at    TIMESTAMPTZ,
    retires_at    TIMESTAMPTZ  -- previous 状态下的"计划过期时间"，到点被 rotator 清理
);

-- 同一时刻只允许一条 current / 一条 previous。部分唯一索引 → Postgres 在
-- INSERT 冲突时返回错误，保证事务语义清晰。
CREATE UNIQUE INDEX IF NOT EXISTS uq_jwt_secrets_current  ON jwt_secrets(status) WHERE status = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS uq_jwt_secrets_previous ON jwt_secrets(status) WHERE status = 'previous';

-- retires_at 上的索引用于 rotator 扫描 "到点的 previous 应当 retire"。
CREATE INDEX IF NOT EXISTS idx_jwt_secrets_retires_at ON jwt_secrets(status, retires_at);

-- 启动时由 Go 层 BootstrapIfEmpty 注入当前 JWT_SECRET 作为 current，
-- 不在此 migration 里插入 —— 否则需要在 SQL 里读环境变量。
