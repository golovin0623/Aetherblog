# 启动、环境、移动端调试 — 完整手册

> **何时读：** 启动 / 重启服务出错；首次接手仓库；环境变量出问题；用手机或平板访问本地服务；调试响应式 / iOS PWA 行为。

---

## 1. 启动模式速查

| 命令 | 用途 | 何时用 |
| --- | --- | --- |
| `./start.sh --gateway` | **本地默认 / 验证用入口**：拉起所有服务 + Nginx 网关 | 几乎所有日常场景 |
| `./start.sh` | 直连模式：blog/admin/api/ai 各自独立端口，无网关 | 调试单服务 hot reload；用户明确要求"直连" |
| `./start.sh --prod` | 生产模式：统一网关 :7899 | 在本机模拟生产 |
| `./stop.sh` | 停应用，**保留中间件**（PostgreSQL / Redis） | 临时停服务 |
| `./stop.sh --all` | 全停（含 docker-compose 中间件） | 完整收工 |

> ⚠️ **本地启动 / 重启验证一律走 `--gateway`**
>
> 直连模式不会拉起 nginx 容器，无法通过 `http://localhost:7899` 验证路由 / CORS / SSE 透传等真实链路。除非用户明确说"直连"或在调试单个服务，**默认 `--gateway`**。

### 网关模式 URL（默认验证入口）

- 统一入口 `http://localhost:7899`
  - `/` → 博客前台
  - `/admin/` → 管理后台
  - `/api/` → 后端 API
  - `/api/v1/ai/` → AI 服务（已配 `X-Accel-Buffering: no` 支持 SSE）

### 直连模式 URL（仅调试单服务）

- Blog: `http://localhost:3000`
- Admin: `http://localhost:5173`
- Backend API: `http://localhost:8080/api`
- AI Service: `http://localhost:8000`

### 生产模式

- Gateway: `http://localhost:7899`（唯一对外入口）

---

## 2. `bootstrap_env` 自动准备

`start.sh` 在 `main()` 调用 `bootstrap_env()`（脚本前部，紧挨 `check_dependencies`），自动：

1. **缺 `.env`** → 从 `.env.example` 拷贝。
2. **`.env` 中以下变量任一为空** → 用 `openssl rand -base64 48` / Fernet 就地生成；**已有非空值不会被覆盖**（保护手填密钥）：
   - `JWT_SECRET`
   - `AETHERBLOG_AI_INTERNAL_SERVICE_TOKEN`
   - `AI_INTERNAL_SERVICE_TOKEN`
   - `AI_CREDENTIAL_ENCRYPTION_KEYS`
3. **缺 `apps/blog/.env.local` 或 `apps/admin/.env.local`** → 从同目录 `.env.local.example` 拷贝。

`.env.example` 默认值已对齐 `docker-compose.yml` 中间件容器与本机 HTTP 调试链路：

```
POSTGRES_PASSWORD=aetherblog123
REDIS_HOST=localhost
REDIS_PASSWORD=aetherblog_dev
AUTH_COOKIE_SECURE=false
```

生产部署时按 `.env.example` 注释中的 `[PROD]` 标签**逐字段替换**。

### 接手"半坏" `.env` 的最快修复

不要逐字段对比，直接重建：

```bash
mv .env .env.bak && ./start.sh --gateway
```

让脚本重建一个干净的 `.env`，需要的非默认值再从 `.env.bak` 挑回去。

---

## 3. 关键环境变量（节选）

完整清单见 `.env.example`。下表只列**容易踩坑或必须了解的**：

| 变量 | 默认 | 备注 |
| --- | --- | --- |
| `GATEWAY_PORT` | `7899` | 统一网关端口 |
| `POSTGRES_PASSWORD` | `aetherblog123` | 中间件容器密码 |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | 容器内连接 |
| `REDIS_PASSWORD` | `aetherblog_dev` | 生产必换 |
| `AUTH_COOKIE_SECURE` | `false` | HTTP 调试必为 false；HTTPS 生产必为 true |
| `JWT_SECRET` | 自动生成 | bootstrap_env 守护；手填后不被覆盖 |
| `AI_CREDENTIAL_ENCRYPTION_KEYS` | 自动生成 | Fernet keys（base64，44 字符含 `=` padding，**不要被 shell 截断**） |
| `OPENAI_API_KEY` | — | AI 功能需要；通过 admin 后台设置更优 |
| `AETHERBLOG_LOG_LEVEL` / `AI_LOG_LEVEL` | `INFO` | 进程启动时日志级别（运行时可在线调整，见 `backend-runtime.md`） |
| `AETHERBLOG_JWT_ROTATION_INTERVAL` | `7d` | JWT 签名密钥定时轮换间隔 |
| `AETHERBLOG_JWT_PREVIOUS_GRACE` | `48h` | 旧密钥保留验签宽限期 |

---

## 4. 移动端真机调试

手机和 Mac 在同一 Wi-Fi 下，通过局域网 IP 访问本地开发服务器。

### 推荐方式：网关模式（统一入口）

```bash
./start.sh --gateway
```

手机浏览器访问 **`http://<Mac-IP>:7899`**：

- `/` → 博客前台
- `/admin/` → 管理后台
- `/api` → 后端 API

> **关键配置：** `apps/blog/.env.local` 中 `NEXT_PUBLIC_ADMIN_URL=/admin/`（**相对路径**），确保管理后台链接在手机上也能正确跳转。如果写成绝对 URL（`http://localhost:5173/`），手机浏览器会跳到自己 localhost 而不是 Mac。

### 备选方式：直连端口

```bash
cd apps/blog && pnpm dev -- -p 3000              # 博客 http://<Mac-IP>:3000
cd apps/admin && pnpm dev -- --host 0.0.0.0      # 管理后台 http://<Mac-IP>:5173
```

> Vite 默认只监听 `localhost`，**必须加 `--host 0.0.0.0`** 才能从手机访问。

### 远程调试

- **iOS Safari：** Mac Safari → 开发 → 选择设备 → 选择页面（需在 iPhone 设置 → Safari → 高级中开启「Web 检查器」）
- **Android Chrome：** Mac Chrome → 访问 `chrome://inspect` → 选择设备（需 USB 连接 + 开发者选项中开启「USB 调试」）

### 移动端编码约束

| 规则 | 说明 |
| --- | --- |
| 移动端判定 | 统一用 `useMediaQuery('(max-width: 768px)')` |
| 底部面板 | Bottom Sheet 模式：`max-h-[66vh]`，内容溢出滚动，点击遮罩关闭 |
| Safe Area | 底部区域 `pb-[max(1rem,env(safe-area-inset-bottom))]` |
| 触控目标 | 按钮最小 **44×44 px** |
| 编辑器默认模式 | 移动端默认 `'edit'`（源码） / 桌面端默认 `'split'`（分屏） |
| 响应式修改 | **仅调整移动端样式，不影响桌面端布局**（这是反复踩过的红线） |

---

## 5. 手动后端开发命令

```bash
cd apps/server-go
go build ./...                  # 全包编译
go run ./cmd/server             # 启动开发服务器
go test ./... -v                # 跑所有测试（详细输出）
air                             # 若装了 air，热重载
```

数据库迁移工具：`go run ./cmd/migrate`（详见 `database-migrations.md`）。

## 6. 中间件单独启停

```bash
docker compose up -d            # 仅起 PostgreSQL + Redis
docker compose logs -f          # 跟踪日志
docker compose down             # 停中间件
```

## 7. 本地日志文件分工（start.sh）

`start.sh` 把每个服务的 stdout/stderr 重定向到 `*.console.log`，**而不是** `*.log`：

| 文件 | 内容 | 用途 |
| --- | --- | --- |
| `logs/backend.log` / `logs/ai-service.log` | 服务内部 writer 写的**干净 JSON** | admin 日志查看器读取（结构化解析 + 双模式渲染） |
| `logs/backend.console.log` / `logs/ai-service.console.log` | 重定向的彩色 stdout + panic | 人工查看 / `wait_for_*` 崩溃兜底 tail |

> ⚠️ **不要把进程 stdout 重定向回 `*.log`** —— 会与内部 JSON writer 双写并夹带 ANSI 色码，admin 渲染出脏字符。原理详见 `backend-runtime.md` §4「日志查看管线」。
