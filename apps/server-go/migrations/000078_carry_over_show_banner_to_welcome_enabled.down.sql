-- 不可逆：无法区分 welcome_enabled='false' 是本迁移收敛而来、还是管理员主动设置的，
-- 贸然回写 'true' 会误开本就想关闭的欢迎页。按 000045 的不对称回滚约定，down 为 no-op。
SELECT 1;
