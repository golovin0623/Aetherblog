---
description: 移动端真机调试 - 在手机上访问本地开发服务器进行 UI 调试
---

# 移动端真机调试工作流

通过局域网让手机访问 Mac 上的开发服务器，实现移动端 UI 的真实设备调试。

## 前置条件

1. 手机和 Mac 连接在同一 Wi-Fi 网络
2. Mac 防火墙允许入站连接（系统设置 → 网络 → 防火墙 → 允许入站连接）

## 工作流步骤

### 1. 获取 Mac 局域网 IP

// turbo
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1
```

记住返回的 IP 地址（如 `<Mac IP>`）。

### 2. 启动服务（推荐网关模式）

```bash
./start.sh --gateway    # 启动所有服务 + Nginx 网关
```

> **关键配置:** 确保 `apps/blog/.env.local` 中 `NEXT_PUBLIC_ADMIN_URL=/admin/`（相对路径），
> 否则管理后台链接会跳转到 `localhost:5173`，手机无法访问。

### 3. 手机访问

#### 方式一：网关统一入口（推荐）

| 路径 | 服务 |
|:-----|:-----|
| `http://<Mac IP>:7899` | 博客前台 |
| `http://<Mac IP>:7899/admin/` | 管理后台 |
| `http://<Mac IP>:7899/api` | 后端 API |

#### 方式二：直连端口（备选）

```bash
cd apps/blog && npm run dev -- -p 3000           # http://<Mac IP>:3000
cd apps/admin && npm run dev -- --host 0.0.0.0   # http://<Mac IP>:5173
```

> Vite 默认只监听 localhost，必须加 `--host 0.0.0.0` 才能从其他设备访问。

示例：`http://<Mac IP>:3000`

### 4. 调试技巧

#### 移动端 Console 查看
- **iOS Safari**: Mac 上打开 Safari → 开发 → 选择手机设备 → 选择页面
- **Android Chrome**: Mac 上打开 Chrome → `chrome://inspect` → 选择设备

#### 响应式布局断点参考

| 断点 | 宽度 | 说明 |
|:-----|:-----|:-----|
| `sm` | 640px | 小屏手机 |
| `md` | 768px | 平板 / 大屏手机横屏 |
| `lg` | 1024px | 小尺寸笔记本 |

项目中移动端判断使用 `useMediaQuery('(max-width: 768px)')` 即 `md` 断点。

#### AI 助手调试约束

调试移动端 UI 时，AI 助手应遵循以下约束：

1. **不随意修改桌面端布局** — 仅调整移动端相关的响应式样式
2. **使用 `isMobile` 条件分支** — 项目中统一使用 `useMediaQuery('(max-width: 768px)')` 判断移动端
3. **底部面板使用 Bottom Sheet 模式** — `max-h-[66vh]`，内容溢出滚动，点击遮罩关闭
4. **注意 safe-area** — 底部操作区域使用 `pb-[max(1rem,env(safe-area-inset-bottom))]`
5. **触控优化** — 按钮最小触控区域 44x44px，避免悬停依赖效果

### 5. 常见问题

| 问题 | 解决方案 |
|:-----|:---------|
| 手机无法访问 | 检查是否同一 Wi-Fi；检查 Mac 防火墙设置 |
| Vite 连不上 | 确认启动时加了 `--host 0.0.0.0` |
| HTTPS 报错 | 本地开发使用 HTTP，不要加 `https://` |
| 端口被占用 | 换端口：`-p 3001` 或 `--port 3001` |
| HMR 不生效 | Vite 需在 `vite.config.ts` 中配置 `server.hmr.host` |
