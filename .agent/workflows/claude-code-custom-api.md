---
description: 配置 Claude Code CLI 使用自定义 API 端点
---

# Claude Code CLI 自定义 API 配置指南

> 本指南适用于将 Claude Code CLI 配置为使用自定义 API 代理服务器（如 `deepai.golovin.cn`）

## 📋 前置条件

- Claude Code CLI 已安装（`npm install -g @anthropic-ai/claude-code`）
- 自定义 API 服务器地址和密钥

## 🚀 配置步骤

### Step 1: 首次启动并完成登录

> [!IMPORTANT]
> Claude Code CLI v2.x 强制要求完成 onboarding 流程，无法跳过。
> 必须先完成一次官方登录，才能配置自定义 API。

```bash
claude --dangerously-skip-permissions
```

按照提示：
1. 选择主题（Light/Dark mode）
2. 选择 **Anthropic Console account**（API 计费模式）
3. 完成 OAuth 登录

### Step 2: 配置 settings.json

```bash
cat > ~/.claude/settings.json << 'EOF'
{
  "apiProvider": "anthropic",
  "hasCompletedOnboarding": true,
  "theme": "light",
  "apiKeyHelper": "echo YOUR_API_KEY"
}
EOF
```

> [!TIP]
> `apiKeyHelper` 是一个 shell 命令，Claude Code 会执行它并使用输出作为 API Key。
> 将 `YOUR_API_KEY` 替换为你的实际密钥。

### Step 3: 登出已保存的 OAuth Token

启动 Claude CLI 并登出：

```bash
claude
# 在 Claude CLI 中输入：
/logout
```

或者直接删除凭证文件：

```bash
rm ~/.claude/.credentials.json 2>/dev/null
```

### Step 4: 创建快捷命令脚本

```bash
mkdir -p ~/.local/bin

cat > ~/.local/bin/claudefree << 'EOF'
#!/bin/bash
export ANTHROPIC_BASE_URL="https://YOUR_API_HOST/path"
export ANTHROPIC_API_KEY="YOUR_API_KEY"
exec /opt/homebrew/bin/claude --dangerously-skip-permissions "$@"
EOF

chmod +x ~/.local/bin/claudefree
```

确保 `~/.local/bin` 在 PATH 中：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Step 5: 验证配置

```bash
claudefree
# 输入 "hi" 测试是否正常响应
```

## 📁 当前配置文件一览

### ~/.claude/settings.json

```json
{
  "apiProvider": "anthropic",
  "hasCompletedOnboarding": true,
  "theme": "light",
  "apiKeyHelper": "echo Vs2016"
}
```

### ~/.local/bin/claudefree

```bash
#!/bin/bash
export ANTHROPIC_BASE_URL="https://deepai.golovin.cn/antigravity"
export ANTHROPIC_API_KEY="Vs2016"
exec /opt/homebrew/bin/claude --dangerously-skip-permissions "$@"
```

## ❓ 常见问题

### Q: 为什么设置了环境变量还要登录？

Claude Code CLI 的 onboarding 流程是强制的，与 API Key 配置无关。必须先完成一次登录来"解锁"CLI。

### Q: 为什么使用 `apiKeyHelper` 而不是环境变量？

| 配置方式 | 优先级 | 说明 |
|:---------|:-------|:-----|
| `apiKeyHelper` | 最高 | 强制覆盖已保存的 OAuth Token |
| OAuth Token | 中 | 登录后自动保存，会覆盖环境变量 |
| 环境变量 | 最低 | 被 OAuth Token 覆盖 |

### Q: 出现 "密码错误" 怎么办？

1. 确认 `apiKeyHelper` 配置正确
2. 执行 `/logout` 清除 OAuth Token
3. 用 curl 测试 API 是否可用：

```bash
curl -s "https://YOUR_API_HOST/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'
```

## 🔄 重新配置流程（快速参考）

```bash
# 1. 配置 settings.json
cat > ~/.claude/settings.json << 'EOF'
{
  "apiProvider": "anthropic",
  "hasCompletedOnboarding": true,
  "theme": "light",
  "apiKeyHelper": "echo Vs2016"
}
EOF

# 2. 登出 OAuth
rm ~/.claude/.credentials.json 2>/dev/null

# 3. 启动并测试
claudefree
```
