package service

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/config"
)

// LogReadResult 包含读取日志行的结果及分页游标信息。
type LogReadResult struct {
	Lines      []string `json:"lines"`      // 读取到的日志行列表
	Cursor     string   `json:"cursor"`     // 当前读取位置的游标（Base64 编码）
	NextCursor *string  `json:"nextCursor"` // 上一批数据的游标，用于向前翻页（可选）
}

// LogFileInfo 描述一个可用的日志文件元信息。
type LogFileInfo struct {
	Level         string    `json:"level"`         // 日志级别或服务名（如 "BACKEND"、"AI"）
	Filename      string    `json:"filename"`      // 日志文件名
	Size          int64     `json:"size"`          // 文件大小（字节）
	SizeFormatted string    `json:"sizeFormatted"` // 格式化后的文件大小（如 "1.2 MB"）
	Exists        bool      `json:"exists"`        // 文件是否存在
	Modified      time.Time `json:"modified"`      // 最后修改时间
}

// serviceLogFile 将逻辑服务名映射到具体的日志文件名。
type serviceLogFile struct {
	Service  string // 前端过滤下拉框中的展示名称
	Filename string // 日志目录中的文件名
}

// LogViewerService 从各服务日志文件中读取应用日志。
type LogViewerService struct {
	cfg *config.Config
}

// NewLogViewerService 创建 LogViewerService 实例，日志文件从配置中指定的目录读取。
func NewLogViewerService(cfg *config.Config) *LogViewerService {
	return &LogViewerService{cfg: cfg}
}

// serviceFiles 定义需要聚合读取的所有服务日志文件列表。
var serviceFiles = []serviceLogFile{
	{Service: "backend", Filename: "backend.log"},
	{Service: "ai-service", Filename: "ai-service.log"},
}

// logFileMap 将级别/过滤器名称映射到具体日志文件，兼容旧版 API。
// "ALL" 触发多文件聚合模式，其余值读取对应单个服务文件。
var logFileMap = map[string]string{
	"ALL":     "",               // 触发多文件聚合读取
	"BACKEND": "backend.log",   // 仅读取后端服务日志
	"AI":      "ai-service.log", // 仅读取 AI 服务日志
}

// ListLogFiles 返回所有可用日志文件的元信息列表。
// 结果首条为汇总的 "ALL" 条目（含所有服务的合计大小），后续为各服务单独条目。
func (s *LogViewerService) ListLogFiles() []LogFileInfo {
	var files []LogFileInfo
	logDir := s.cfg.Log.Path

	for _, sf := range serviceFiles {
		path := filepath.Join(logDir, sf.Filename)
		info, err := os.Stat(path)
		if err != nil {
			// 文件不存在时仍返回条目，标记为 Exists=false
			files = append(files, LogFileInfo{
				Level:         strings.ToUpper(sf.Service),
				Filename:      sf.Filename,
				Size:          0,
				SizeFormatted: "0 B",
				Exists:        false,
			})
			continue
		}
		files = append(files, LogFileInfo{
			Level:         strings.ToUpper(sf.Service),
			Filename:      sf.Filename,
			Size:          info.Size(),
			SizeFormatted: formatFileSize(info.Size()),
			Exists:        true,
			Modified:      info.ModTime(),
		})
	}

	// 构建汇总的 "ALL" 条目，聚合所有服务的文件大小和最新修改时间
	var totalSize int64
	var anyExists bool
	var latestMod time.Time
	for _, f := range files {
		totalSize += f.Size
		if f.Exists {
			anyExists = true
			if f.Modified.After(latestMod) {
				latestMod = f.Modified
			}
		}
	}
	allEntry := LogFileInfo{
		Level:         "ALL",
		Filename:      "(all services)",
		Size:          totalSize,
		SizeFormatted: formatFileSize(totalSize),
		Exists:        anyExists,
		Modified:      latestMod,
	}
	// 将 ALL 条目置于列表首位
	files = append([]LogFileInfo{allEntry}, files...)

	return files
}

// ReadLogs 读取日志行，支持多文件聚合模式。
// level 参数说明：
//   - "ALL"：聚合所有服务日志，按时间戳排序后返回最新 N 行
//   - "INFO"/"WARN"/"ERROR"/"DEBUG"：跨文件按日志级别过滤
//   - "BACKEND"/"AI"：仅读取对应服务的单个日志文件
//
// JSON 格式日志行支持按 level 字段过滤；keyword 搜索在原始行上进行。
// limit 范围 [1, 2000]，默认 100。
func (s *LogViewerService) ReadLogs(level string, limit int, keyword string, cursor string) (*LogReadResult, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 2000 {
		limit = 2000
	}

	level = strings.ToUpper(level)
	if level == "" {
		level = "ALL"
	}

	logDir := s.cfg.Log.Path

	// ALL 模式：聚合所有服务日志
	if level == "ALL" {
		return s.readAggregated(logDir, limit, keyword, "", cursor)
	}

	// 日志级别过滤模式：跨所有文件按 level 字段筛选
	if level == "INFO" || level == "WARN" || level == "ERROR" || level == "DEBUG" {
		return s.readAggregated(logDir, limit, keyword, strings.ToLower(level), cursor)
	}

	// 单服务文件模式
	fileName, ok := logFileMap[level]
	if !ok {
		// 未知 level，回退到全量聚合模式
		return s.readAggregated(logDir, limit, keyword, "", cursor)
	}

	return s.readSingleFile(filepath.Join(logDir, fileName), limit, keyword, cursor)
}

// readAggregated 从所有服务日志文件中读取日志，按时间戳排序后返回最新 N 条。
// cursor 格式：Base64(JSON({"service": offset}))，用于多文件增量读取。
// levelFilter 非空时仅返回匹配该级别的 JSON 日志行。
func (s *LogViewerService) readAggregated(logDir string, limit int, keyword string, levelFilter string, cursor string) (*LogReadResult, error) {
	// 解析多文件游标，获取各服务文件的读取偏移量
	offsets := parseMultiCursor(cursor)

	type logEntry struct {
		raw       string
		timestamp time.Time
		source    string
	}

	var allEntries []logEntry

	for _, sf := range serviceFiles {
		filePath := filepath.Join(logDir, sf.Filename)
		f, err := os.Open(filePath)
		if err != nil {
			continue // 文件不存在时跳过，继续处理其他服务
		}

		info, err := f.Stat()
		if err != nil {
			f.Close()
			continue
		}

		// 使用游标中的偏移量；未设置时从文件末尾开始读
		offset := offsets[sf.Service]
		if offset <= 0 {
			offset = info.Size()
		}

		// 多读一些行用于后续合并排序后截取
		lines, _ := readTailLines(f, offset, limit*2, "")
		f.Close()

		for _, line := range lines {
			// 关键字过滤（大小写不敏感）
			if keyword != "" && !strings.Contains(strings.ToLower(line), strings.ToLower(keyword)) {
				continue
			}

			// 解析 JSON 日志行以提取时间戳和级别
			var entry map[string]interface{}
			ts := time.Now() // 无法解析时使用当前时间作为兜底
			entryLevel := ""
			if json.Unmarshal([]byte(line), &entry) == nil {
				if t, ok := entry["timestamp"].(string); ok {
					if parsed, err := time.Parse(time.RFC3339Nano, t); err == nil {
						ts = parsed
					}
				}
				if l, ok := entry["level"].(string); ok {
					entryLevel = strings.ToLower(l)
				}
			}

			// 应用日志级别过滤
			if levelFilter != "" && entryLevel != levelFilter {
				continue
			}

			allEntries = append(allEntries, logEntry{raw: line, timestamp: ts, source: sf.Service})
		}
	}

	// 按时间戳升序排列（最新日志在末尾，符合日志查看习惯）
	sort.Slice(allEntries, func(i, j int) bool {
		return allEntries[i].timestamp.Before(allEntries[j].timestamp)
	})

	// 仅保留最新的 limit 条记录
	if len(allEntries) > limit {
		allEntries = allEntries[len(allEntries)-limit:]
	}

	result := make([]string, len(allEntries))
	for i, e := range allEntries {
		result[i] = e.raw
	}

	return &LogReadResult{
		Lines:  result,
		Cursor: cursor,
	}, nil
}

// readSingleFile 从单个日志文件中读取日志（兼容旧版接口）。
// cursor 为 Base64 编码的文件偏移量字符串，为空时从文件末尾开始读取。
func (s *LogViewerService) readSingleFile(logPath string, limit int, keyword string, cursor string) (*LogReadResult, error) {
	f, err := os.Open(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &LogReadResult{Lines: []string{}}, nil
		}
		return nil, fmt.Errorf("open log file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat log file: %w", err)
	}

	// 解析游标中的偏移量
	var offset int64
	if cursor != "" {
		decoded, err := base64.StdEncoding.DecodeString(cursor)
		if err == nil {
			offset, _ = strconv.ParseInt(string(decoded), 10, 64)
		}
	}
	if offset <= 0 {
		offset = info.Size() // 默认从文件末尾开始
	}

	lines, newOffset := readTailLines(f, offset, limit, keyword)

	result := &LogReadResult{
		Lines:  lines,
		Cursor: encodeCursor(offset),
	}

	if newOffset > 0 {
		nc := encodeCursor(newOffset)
		result.NextCursor = &nc
	}

	return result, nil
}

// GetLogFilePath 返回指定级别对应日志文件的完整路径，用于日志文件下载功能。
// 当 level 为 "ALL" 时，返回体积最大的服务日志文件路径。
// 错误场景：level 未知、对应日志文件不存在。
func (s *LogViewerService) GetLogFilePath(level string) (string, error) {
	level = strings.ToUpper(level)
	if level == "" {
		level = "ALL"
	}

	// ALL 模式：返回体积最大的服务日志文件
	if level == "ALL" {
		logDir := s.cfg.Log.Path
		var bestPath string
		var bestSize int64
		for _, sf := range serviceFiles {
			p := filepath.Join(logDir, sf.Filename)
			if info, err := os.Stat(p); err == nil && info.Size() > bestSize {
				bestPath = p
				bestSize = info.Size()
			}
		}
		if bestPath == "" {
			return "", fmt.Errorf("no log files found")
		}
		return bestPath, nil
	}

	fileName, ok := logFileMap[level]
	if !ok {
		return "", fmt.Errorf("unknown log level: %s", level)
	}

	logPath := filepath.Join(s.cfg.Log.Path, fileName)
	if _, err := os.Stat(logPath); err != nil {
		return "", fmt.Errorf("log file not found: %s", fileName)
	}

	return logPath, nil
}

// parseMultiCursor 解码多文件游标（Base64 编码的 JSON 映射）。
// 支持兼容旧版单偏移量格式（纯数字字符串），旧格式被视为 backend 服务的偏移量。
func parseMultiCursor(cursor string) map[string]int64 {
	if cursor == "" {
		return map[string]int64{}
	}
	decoded, err := base64.StdEncoding.DecodeString(cursor)
	if err != nil {
		return map[string]int64{}
	}
	var offsets map[string]int64
	if json.Unmarshal(decoded, &offsets) != nil {
		// 兼容旧版单文件游标格式（纯整数字符串）
		if n, err := strconv.ParseInt(string(decoded), 10, 64); err == nil {
			return map[string]int64{"backend": n}
		}
		return map[string]int64{}
	}
	return offsets
}

// readTailLines 从文件 endOffset 位置向前读取最多 limit 行（类似 tail -n）。
// 按块读取以避免将整个文件载入内存；若 startOffset > 0 则跳过不完整的首行。
// 返回值：过滤后的日志行列表，以及可用于继续向前翻页的 nextOffset（0 表示已到文件头）。
func readTailLines(f *os.File, endOffset int64, limit int, keyword string) ([]string, int64) {
	if endOffset <= 0 {
		return []string{}, 0
	}

	// 按 limit 估算需要读取的块大小（每行约 512 字节）
	chunkSize := int64(limit * 512)
	if chunkSize > endOffset {
		chunkSize = endOffset
	}

	startOffset := endOffset - chunkSize
	if startOffset < 0 {
		startOffset = 0
	}

	if _, err := f.Seek(startOffset, io.SeekStart); err != nil {
		return []string{}, 0
	}

	reader := bufio.NewReader(io.LimitReader(f, chunkSize))

	// 若不是从文件头开始，跳过第一行（可能是不完整的行）
	if startOffset > 0 {
		_, _ = reader.ReadString('\n')
	}

	var allLines []string
	for {
		line, err := reader.ReadString('\n')
		line = strings.TrimRight(line, "\r\n")
		if line != "" {
			// 应用关键字过滤（大小写不敏感）
			if keyword == "" || strings.Contains(strings.ToLower(line), strings.ToLower(keyword)) {
				allLines = append(allLines, line)
			}
		}
		if err != nil {
			break
		}
	}

	// 仅保留最新的 limit 行
	if len(allLines) > limit {
		allLines = allLines[len(allLines)-limit:]
	}

	// nextOffset 指向当前块起始位置，用于继续向前翻页（已到文件头则为 0）
	var nextOffset int64
	if startOffset > 0 {
		nextOffset = startOffset
	}

	return allLines, nextOffset
}

// encodeCursor 将文件偏移量编码为 Base64 字符串用于分页游标。
func encodeCursor(offset int64) string {
	return base64.StdEncoding.EncodeToString([]byte(strconv.FormatInt(offset, 10)))
}

// formatFileSize 将字节数转换为人类可读的文件大小字符串（B/KB/MB/GB/TB）。
func formatFileSize(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	val := float64(b) / float64(div)
	units := []string{"KB", "MB", "GB", "TB"}
	return fmt.Sprintf("%.1f %s", val, units[exp])
}
