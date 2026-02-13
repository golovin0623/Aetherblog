#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/reports}"
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:7899}"
AUTH_HEADER="${AUTH_HEADER:-}"

ALERT_ERROR_RATE_THRESHOLD="${ALERT_ERROR_RATE_THRESHOLD:-0.05}"
ALERT_EMPTY_RATIO_THRESHOLD="${ALERT_EMPTY_RATIO_THRESHOLD:-0.20}"
ALERT_USAGE_LOG_FAILURE_RATIO_THRESHOLD="${ALERT_USAGE_LOG_FAILURE_RATIO_THRESHOLD:-0.02}"

USE_SAMPLE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sample) USE_SAMPLE=true ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
  shift
done

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[ERROR] missing command: $cmd"
    exit 1
  fi
}

fetch_json() {
  local url="$1"
  if [ -n "$AUTH_HEADER" ]; then
    curl -fsS --max-time 10 -H "$AUTH_HEADER" "$url"
  else
    curl -fsS --max-time 10 "$url"
  fi
}

safe_jq_number() {
  local expr="$1"
  local payload="$2"
  echo "$payload" | jq -r "$expr // 0" 2>/dev/null
}

main() {
  require_cmd jq
  mkdir -p "$OUTPUT_DIR"

  local timestamp
  timestamp="$(date -Iseconds)"
  local report_date
  report_date="$(date +%F)"
  local report_file="$OUTPUT_DIR/${report_date}-ai-observability-hourly.csv"

  local dashboard_json
  local metrics_json

  if [ "$USE_SAMPLE" = true ]; then
    dashboard_json='{"code":200,"data":{"overview":{"totalCalls":120,"errorCalls":6}}}'
    metrics_json='{"code":200,"data":{"total":{"requests":120},"usage_logging":{"failures_total":3}}}'
    echo "[INFO] using built-in sample payload"
  else
    dashboard_json="$(fetch_json "$GATEWAY_BASE_URL/api/v1/admin/stats/ai-dashboard?days=1&pageNum=1&pageSize=20")"
    metrics_json="$(fetch_json "$GATEWAY_BASE_URL/api/v1/admin/metrics/ai")"
  fi

  local total_calls
  total_calls="$(safe_jq_number '.data.overview.totalCalls' "$dashboard_json")"
  local error_calls
  error_calls="$(safe_jq_number '.data.overview.errorCalls' "$dashboard_json")"
  local metric_requests
  metric_requests="$(safe_jq_number '.data.total.requests' "$metrics_json")"
  local usage_failures
  usage_failures="$(safe_jq_number '.data.usage_logging.failures_total' "$metrics_json")"

  local error_rate
  error_rate="$(awk -v e="$error_calls" -v t="$total_calls" 'BEGIN { if (t <= 0) print 0; else printf "%.6f", e / t }')"

  local empty_ratio
  empty_ratio="$(awk -v t="$total_calls" 'BEGIN { if (t <= 0) print 1; else print 0 }')"

  local usage_failure_ratio
  usage_failure_ratio="$(awk -v f="$usage_failures" -v r="$metric_requests" 'BEGIN { if (r <= 0) print 0; else printf "%.6f", f / r }')"

  local usage_success_rate
  usage_success_rate="$(awk -v ratio="$usage_failure_ratio" 'BEGIN { printf "%.6f", 1 - ratio }')"

  local status="healthy"
  if awk -v v="$error_rate" -v t="$ALERT_ERROR_RATE_THRESHOLD" 'BEGIN { exit !(v > t) }'; then
    status="warning"
  fi
  if awk -v v="$empty_ratio" -v t="$ALERT_EMPTY_RATIO_THRESHOLD" 'BEGIN { exit !(v > t) }'; then
    status="warning"
  fi
  if awk -v v="$usage_failure_ratio" -v t="$ALERT_USAGE_LOG_FAILURE_RATIO_THRESHOLD" 'BEGIN { exit !(v > t) }'; then
    status="warning"
  fi

  if [ ! -f "$report_file" ]; then
    echo "timestamp,total_calls,error_calls,error_rate,empty_data_ratio,usage_log_failures,usage_log_failure_ratio,usage_log_success_rate,status" > "$report_file"
  fi

  echo "$timestamp,$total_calls,$error_calls,$error_rate,$empty_ratio,$usage_failures,$usage_failure_ratio,$usage_success_rate,$status" >> "$report_file"

  echo "[INFO] hourly observation appended: $report_file"
  echo "[INFO] error_rate=$error_rate empty_ratio=$empty_ratio usage_failure_ratio=$usage_failure_ratio status=$status"
}

main "$@"
