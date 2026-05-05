# 灵境移动端升级开发执行计划

## 1) 范围
- 应用：`apps/blog/app/agent/workspace`
- 类型：UI 文案升级 + 交互状态增强 + 请求参数生效修复

## 2) 实施步骤
1. **品牌统一**
   - 修改工作台 metadata/title，将“Agent”替换为“灵境”。
2. **状态建模**
   - 在 `WorkspaceClient` 增加 `sessionModelOverride` 状态。
   - 当 `activeSession` 变化时同步覆盖状态。
3. **交互联动**
   - `handleModelChange` 同时更新 `sessionModelOverride` 与 `sessions`。
4. **发送链路修复**
   - `handleSend` 请求体优先读取 `sessionModelOverride` 的 `modelId/providerCode`。
   - 新建会话分支下也保证读取的是当前覆盖状态。
5. **移动端可感知优化**
   - `ModelPicker` 紧凑模式增加“模型 · xxx”显示，强化当前控制项识别。

## 3) 风险与缓解
- 风险：覆盖状态与会话持久化不一致。
  - 缓解：以 `activeSession` 变更为同步源，发送时“覆盖优先 + 会话回退”。
- 风险：UI 文案改动遗漏。
  - 缓解：对 workspace 相关文案做 scoped 检查。

## 4) 验收
- 手工检查：切换模型后立即发送，network payload 与选项一致。
- 程序检查：`pnpm --filter @aetherblog/blog typecheck` 通过。
