# AI 可观测发布前置检查与灰度回滚策略（2026-02-13）

## 1. 交付内容
- 新增 `ops/release/preflight.sh`：发布前置检查脚本。
- 增强 `ops/webhook/deploy.sh`：
  - 支持 `DEPLOY_MODE=full|canary|rollback`；
  - 支持 `CANARY_SERVICES` 灰度服务列表；
  - 支持 `ROLLBACK_VERSION` 一键回滚版本；
  - 默认执行 preflight，失败可阻断部署。

## 2. preflight 覆盖项
- 迁移版本：检查 `flyway_schema_history` 最新成功版本（默认 `>= 2.20`）。
- 关键 API：网关健康、后端到 AI 服务健康链路。
- 权限：无 token 访问受保护统计与日志接口应返回 `401/403`。
- 日志可读性：后端容器 `/app/logs` 目录可读取。

## 3. 环境变量与开关
- `PREFLIGHT_BLOCK=true|false`：是否 preflight 失败即阻断。
- `PREFLIGHT_ARGS`：传给 preflight 的参数（例如 `--no-runtime`）。
- `DEPLOY_MODE`：
  - `full`：全量发布（默认）
  - `canary`：仅更新 `CANARY_SERVICES`
  - `rollback`：以 `ROLLBACK_VERSION` 回滚全量服务
- `CANARY_SERVICES=backend,ai-service`：灰度服务列表。
- `ROLLBACK_VERSION=<tag>`：回滚镜像标签。

## 4. 灰度与回滚流程
1. **灰度发布**
   ```bash
   DEPLOY_MODE=canary CANARY_SERVICES=backend,ai-service ./ops/webhook/deploy.sh
   ```
2. **观测窗口**（建议 10~30 分钟）
   - 检查 `/health`、AI 看板错误率、日志写入失败计数。
3. **全量放量**
   ```bash
   DEPLOY_MODE=full ./ops/webhook/deploy.sh
   ```
4. **异常回滚**
   ```bash
   DEPLOY_MODE=rollback ROLLBACK_VERSION=<last_stable_tag> ./ops/webhook/deploy.sh
   ```

## 5. 发布演练记录（本地）
- 已执行：
  ```bash
  bash ops/release/preflight.sh --no-runtime
  bash -n ops/webhook/deploy.sh
  ```
- 结果：脚本语法与静态 preflight 流程通过。
- 待补：灰度环境执行一次完整“发布→观测→回滚”并记录耗时。
