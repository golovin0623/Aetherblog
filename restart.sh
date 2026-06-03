#!/bin/bash

# AetherBlog 快速重启脚本
# 只重启应用容器，不动中间件（PostgreSQL / Redis）
#
# 用法:
#   ./restart.sh              # 重启所有应用容器
#   ./restart.sh backend      # 只重启后端
#   ./restart.sh blog admin   # 重启指定容器
#   ./restart.sh --pull       # 拉取最新镜像后重启

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.prod.yml"

APP_SERVICES=(backend ai-service blog admin gateway)

PULL=false
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=true ;;
    *) TARGETS+=("$arg") ;;
  esac
done

if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("${APP_SERVICES[@]}")
fi

get_project_env_value() {
  local key=$1
  local line value

  if [ ! -f "$PROJECT_ROOT/.env" ]; then
    return 0
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
      "$key="*)
        value="${line#*=}"
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        printf '%s' "$value"
        return 0
        ;;
    esac
  done < "$PROJECT_ROOT/.env"
}

compose_profile_enabled_in() {
  local profiles=$1
  local profile=$2
  profiles="${profiles// /,}"
  case ",$profiles," in
    *",$profile,"*) return 0 ;;
    *) return 1 ;;
  esac
}

uses_compose_socket_proxy() {
  case "$1" in
    http://docker-socket-proxy|http://docker-socket-proxy:*|http://docker-socket-proxy/*|https://docker-socket-proxy|https://docker-socket-proxy:*|https://docker-socket-proxy/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ENV_COMPOSE_PROFILES="${COMPOSE_PROFILES:-$(get_project_env_value COMPOSE_PROFILES)}"
ENV_MONITOR_URL="${DOCKER_SOCKET_PROXY_URL:-$(get_project_env_value DOCKER_SOCKET_PROXY_URL)}"
if compose_profile_enabled_in "$ENV_COMPOSE_PROFILES" "with-monitor" || uses_compose_socket_proxy "$ENV_MONITOR_URL"; then
  if ! compose_profile_enabled_in "$ENV_COMPOSE_PROFILES" "with-monitor"; then
    if [ -n "$ENV_COMPOSE_PROFILES" ]; then
      export COMPOSE_PROFILES="${ENV_COMPOSE_PROFILES},with-monitor"
    else
      export COMPOSE_PROFILES="with-monitor"
    fi
  else
    export COMPOSE_PROFILES="$ENV_COMPOSE_PROFILES"
  fi
elif [ -n "$ENV_COMPOSE_PROFILES" ]; then
  export COMPOSE_PROFILES="$ENV_COMPOSE_PROFILES"
fi

dc() {
  if docker compose version &>/dev/null; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

ensure_monitor_proxy() {
  if ! compose_profile_enabled_in "${COMPOSE_PROFILES:-}" "with-monitor"; then
    return
  fi

  local proxy_status
  proxy_status=$(docker inspect -f '{{.State.Status}}' aetherblog-docker-socket-proxy 2>/dev/null || echo "not_found")
  if [ "$proxy_status" = "running" ]; then
    echo -e "${GREEN}✅ docker-socket-proxy 运行中，容器监控代理可用${NC}"
    return
  fi

  echo -e "${YELLOW}⚠️  容器监控已配置，正在启动 docker-socket-proxy...${NC}"
  dc up -d docker-socket-proxy
}

service_requires_gateway_restart() {
  case "$1" in
    backend|admin|blog|ai-service)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

targets_include() {
  local expected=$1
  local target
  for target in "${TARGETS[@]}"; do
    if [ "$target" = "$expected" ]; then
      return 0
    fi
  done
  return 1
}

targets_need_gateway_restart() {
  local target
  for target in "${TARGETS[@]}"; do
    if service_requires_gateway_restart "$target"; then
      return 0
    fi
  done
  return 1
}

refresh_gateway_if_needed() {
  if ! targets_need_gateway_restart || targets_include "gateway"; then
    return
  fi

  echo -e "${YELLOW}⚠️  上游服务已重启，正在刷新 gateway 的 Docker DNS 解析...${NC}"
  if dc restart gateway >/dev/null 2>&1; then
    RESTARTED+=("gateway(dns-refresh)")
  else
    dc up -d --no-deps gateway
    RECREATED+=("gateway(dns-refresh)")
  fi
}

echo -e "${BLUE}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         ⚡ AetherBlog 快速重启                    ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}[1/3] 检查中间件状态...${NC}"
PG_STATUS=$(docker inspect -f '{{.State.Status}}' aetherblog-postgres 2>/dev/null || echo "not_found")
if [ "$PG_STATUS" != "running" ]; then
  echo -e "${YELLOW}⚠️  PostgreSQL 未运行，先启动中间件...${NC}"
  dc up -d postgres
  until docker exec aetherblog-postgres pg_isready -U aetherblog -d aetherblog &>/dev/null; do
    sleep 1
  done
  echo -e "${GREEN}✅ PostgreSQL 就绪${NC}"
else
  echo -e "${GREEN}✅ PostgreSQL 运行中，跳过${NC}"
fi
echo ""

if [ "$PULL" = true ]; then
  echo -e "${BLUE}[2/3] 拉取最新镜像...${NC}"
  dc pull "${TARGETS[@]}"
  if compose_profile_enabled_in "${COMPOSE_PROFILES:-}" "with-monitor"; then
    dc pull docker-socket-proxy
  fi
  echo ""
else
  echo -e "${BLUE}[2/3] 跳过镜像拉取（使用 --pull 启用）${NC}"
  echo ""
fi

ensure_monitor_proxy

echo -e "${BLUE}[3/3] 重启应用容器: ${TARGETS[*]}${NC}"
START_TIME=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')

RESTARTED=()
RECREATED=()
for svc in "${TARGETS[@]}"; do
  CONTAINER="aetherblog-${svc}"
  if [ "$svc" = "ai-service" ]; then
    CONTAINER="aetherblog-ai-service"
  fi

  STATUS=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not_found")
  if [ "$STATUS" = "running" ] && [ "$PULL" = false ]; then
    docker restart "$CONTAINER" >/dev/null 2>&1
    RESTARTED+=("$svc")
  else
    RECREATED+=("$svc")
  fi
done

if [ ${#RECREATED[@]} -gt 0 ]; then
  dc up -d --no-deps "${RECREATED[@]}"
fi

refresh_gateway_if_needed

END_TIME=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
ELAPSED=$(( (END_TIME - START_TIME) ))

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
if [ ${#RESTARTED[@]} -gt 0 ]; then
  echo -e "${GREEN}⚡ 快速重启: ${RESTARTED[*]}${NC}"
fi
if [ ${#RECREATED[@]} -gt 0 ]; then
  echo -e "${GREEN}🔄 重新创建: ${RECREATED[*]}${NC}"
fi
echo -e "${GREEN}✅ 完成！耗时: ${ELAPSED}ms${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
