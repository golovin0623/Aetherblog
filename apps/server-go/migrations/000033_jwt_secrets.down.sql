DROP INDEX IF EXISTS idx_jwt_secrets_retires_at;
DROP INDEX IF EXISTS uq_jwt_secrets_previous;
DROP INDEX IF EXISTS uq_jwt_secrets_current;
DROP TABLE IF EXISTS jwt_secrets;
