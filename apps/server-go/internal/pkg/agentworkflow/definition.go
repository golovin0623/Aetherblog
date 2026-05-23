// Package agentworkflow 包含 Agent Workflow 画布的稳定验证约束。
// 它被有意设计为轻依赖，以便 handler
// 代码和未来的后台调度器可以在工作流定义保存、发布或执行之前
// 重用相同的保护机制。
package agentworkflow

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

const (
	DefaultMaxNodes          = 200
	DefaultMaxEdges          = 400
	DefaultMaxLoopIterations = 1000
	DefaultMaxTemplateLength = 8000
	DefaultMaxCodeLength     = 40000
)

var (
	nodeIDPattern   = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,79}$`)
	namePattern     = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]{0,79}$`)
	secretRefRegexp = regexp.MustCompile(`^secret:[A-Za-z][A-Za-z0-9_.:/-]{1,127}$`)
	templateRegexp  = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)
	pathRegexp      = regexp.MustCompile(`^(inputs|system|user|workflow|run|nodes|env)(\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*$`)
)

var supportedModes = map[string]bool{
	"fixed":      true,
	"autonomous": true,
	"hybrid":     true,
}

var supportedNodeTypes = map[string]bool{
	"input":     true,
	"output":    true,
	"llm":       true,
	"agent":     true,
	"tool":      true,
	"extractor": true,
	"branch":    true,
	"loop":      true,
	"code":      true,
}

var supportedInputTypes = map[string]bool{
	"string":         true,
	"number":         true,
	"integer":        true,
	"boolean":        true,
	"object":         true,
	"array":          true,
	"array[string]":  true,
	"array[number]":  true,
	"array[object]":  true,
	"array[boolean]": true,
	"file":           true,
}

var supportedVariableScopes = map[string]bool{
	"system":   true,
	"user":     true,
	"workflow": true,
	"run":      true,
}

var supportedConnectorProtocols = map[string]bool{
	"builtin": true,
	"http":    true,
	"openapi": true,
	"mcp":     true,
	"skill":   true,
}

var supportedHTTPMethods = map[string]bool{
	"GET":    true,
	"POST":   true,
	"PUT":    true,
	"PATCH":  true,
	"DELETE": true,
}

var supportedExtractorModes = map[string]bool{
	"jsonpath":           true,
	"jmespath":           true,
	"regex":              true,
	"schema":             true,
	"function_call_args": true,
}

var supportedCodeLanguages = map[string]bool{
	"python":     true,
	"javascript": true,
}

// Definition 是持久化的画布约束。数据库中的 DefinitionJSON
// 解码后应映射到此结构。
type Definition struct {
	Version     int                  `json:"version"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Mode        string               `json:"mode"`
	Inputs      map[string]InputSpec `json:"inputs,omitempty"`
	Nodes       []Node               `json:"nodes"`
	Edges       []Edge               `json:"edges,omitempty"`
}

type InputSpec struct {
	Type        string `json:"type"`
	Required    bool   `json:"required,omitempty"`
	Description string `json:"description,omitempty"`
}

type Node struct {
	ID   string         `json:"id"`
	Type string         `json:"type"`
	Data map[string]any `json:"data,omitempty"`
}

type Edge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type VariableSpec struct {
	Name      string `json:"name"`
	Scope     string `json:"scope"`
	Type      string `json:"type"`
	Value     any    `json:"value,omitempty"`
	SecretRef string `json:"secretRef,omitempty"`
}

type ConnectorSpec struct {
	Code     string         `json:"code"`
	Protocol string         `json:"protocol"`
	Config   map[string]any `json:"config,omitempty"`
}

type ValidationOptions struct {
	MaxNodes          int
	MaxEdges          int
	MaxLoopIterations int
	MaxTemplateLength int
	MaxCodeLength     int
	AllowHTTP         bool
	AllowLocalHTTP    bool
}

type Violation struct {
	Path    string
	Message string
}

type ValidationError struct {
	Violations []Violation
}

func (e *ValidationError) Error() string {
	if e == nil || len(e.Violations) == 0 {
		return ""
	}
	if len(e.Violations) == 1 {
		v := e.Violations[0]
		return fmt.Sprintf("%s: %s", v.Path, v.Message)
	}
	return fmt.Sprintf("%d validation errors; first: %s: %s", len(e.Violations), e.Violations[0].Path, e.Violations[0].Message)
}

func defaultedOptions(opts ValidationOptions) ValidationOptions {
	if opts.MaxNodes <= 0 {
		opts.MaxNodes = DefaultMaxNodes
	}
	if opts.MaxEdges <= 0 {
		opts.MaxEdges = DefaultMaxEdges
	}
	if opts.MaxLoopIterations <= 0 {
		opts.MaxLoopIterations = DefaultMaxLoopIterations
	}
	if opts.MaxTemplateLength <= 0 {
		opts.MaxTemplateLength = DefaultMaxTemplateLength
	}
	if opts.MaxCodeLength <= 0 {
		opts.MaxCodeLength = DefaultMaxCodeLength
	}
	return opts
}

func ValidateDefinition(def Definition, opts ValidationOptions) error {
	opts = defaultedOptions(opts)
	v := validator{}

	if def.Version != 1 {
		v.add("version", "must be 1")
	}
	if strings.TrimSpace(def.Name) == "" {
		v.add("name", "is required")
	}
	if !supportedModes[def.Mode] {
		v.add("mode", "must be fixed, autonomous, or hybrid")
	}
	if len(def.Nodes) == 0 {
		v.add("nodes", "must contain at least one node")
	}
	if len(def.Nodes) > opts.MaxNodes {
		v.add("nodes", fmt.Sprintf("exceeds max nodes %d", opts.MaxNodes))
	}
	if len(def.Edges) > opts.MaxEdges {
		v.add("edges", fmt.Sprintf("exceeds max edges %d", opts.MaxEdges))
	}

	validateInputs(&v, def.Inputs)
	nodeTypes := validateNodes(&v, def.Nodes, opts)
	validateEdges(&v, def.Edges, nodeTypes)
	if len(def.Edges) > 0 {
		validateAcyclic(&v, def.Edges)
	}
	return v.err()
}

func ValidateVariable(spec VariableSpec) error {
	v := validator{}
	if !namePattern.MatchString(spec.Name) {
		v.add("name", "must be a valid variable name")
	}
	if !supportedVariableScopes[spec.Scope] {
		v.add("scope", "must be system, user, workflow, or run")
	}
	if !supportedInputTypes[spec.Type] {
		v.add("type", "unsupported variable type")
	}
	if spec.SecretRef != "" {
		if !secretRefRegexp.MatchString(spec.SecretRef) {
			v.add("secretRef", "must use secret:<provider>/<name> reference syntax")
		}
		if spec.Value != nil {
			v.add("value", "must be empty when secretRef is set")
		}
	}
	return v.err()
}

func ValidateConnector(spec ConnectorSpec, opts ValidationOptions) error {
	opts = defaultedOptions(opts)
	v := validator{}
	if !namePattern.MatchString(spec.Code) {
		v.add("code", "must be a valid connector code")
	}
	if !supportedConnectorProtocols[spec.Protocol] {
		v.add("protocol", "must be builtin, http, openapi, mcp, or skill")
	}

	switch spec.Protocol {
	case "http":
		validateHTTPConnector(&v, spec.Config, opts)
	case "openapi":
		rawURL, _ := stringField(spec.Config, "schemaUrl")
		if rawURL == "" {
			v.add("config.schemaUrl", "is required")
		} else if err := ValidatePublicURL(rawURL, opts); err != nil {
			v.add("config.schemaUrl", err.Error())
		}
	case "mcp":
		transport, _ := stringField(spec.Config, "transport")
		if transport != "streamable_http" && transport != "stdio" {
			v.add("config.transport", "must be streamable_http or stdio")
		}
		if transport == "streamable_http" {
			rawURL, _ := stringField(spec.Config, "url")
			if rawURL == "" {
				v.add("config.url", "is required for streamable_http")
			} else if err := ValidatePublicURL(rawURL, opts); err != nil {
				v.add("config.url", err.Error())
			}
		}
	case "skill":
		path, _ := stringField(spec.Config, "path")
		if path == "" || strings.Contains(path, "..") || strings.HasPrefix(path, "/") {
			v.add("config.path", "must be a relative skill path without traversal")
		}
	}
	return v.err()
}

func ValidateTemplateRefs(value string, maxLength int) error {
	if maxLength <= 0 {
		maxLength = DefaultMaxTemplateLength
	}
	v := validator{}
	if len(value) > maxLength {
		v.add("template", fmt.Sprintf("exceeds max length %d", maxLength))
	}
	for _, match := range templateRegexp.FindAllStringSubmatch(value, -1) {
		expr := strings.TrimSpace(match[1])
		if !pathRegexp.MatchString(expr) {
			v.add("template", fmt.Sprintf("unsupported expression %q", expr))
			continue
		}
		if strings.HasPrefix(expr, "env.") && looksSensitiveName(expr) {
			v.add("template", fmt.Sprintf("sensitive env reference %q is not allowed", expr))
		}
	}
	return v.err()
}

func ValidatePublicURL(raw string, opts ValidationOptions) error {
	opts = defaultedOptions(opts)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("must be an absolute URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && !(opts.AllowHTTP && scheme == "http") {
		return fmt.Errorf("scheme must be https")
	}
	host := strings.Trim(strings.ToLower(u.Hostname()), "[]")
	if host == "" {
		return fmt.Errorf("host is required")
	}
	if !opts.AllowLocalHTTP && isUnsafeHost(host) {
		return fmt.Errorf("host is not allowed")
	}
	return nil
}

func validateInputs(v *validator, inputs map[string]InputSpec) {
	for name, spec := range inputs {
		path := "inputs." + name
		if !namePattern.MatchString(name) {
			v.add(path, "input name is invalid")
		}
		if !supportedInputTypes[spec.Type] {
			v.add(path+".type", "unsupported input type")
		}
	}
}

func validateNodes(v *validator, nodes []Node, opts ValidationOptions) map[string]string {
	seen := map[string]string{}
	for idx, node := range nodes {
		path := fmt.Sprintf("nodes[%d]", idx)
		if !nodeIDPattern.MatchString(node.ID) {
			v.add(path+".id", "must start with a letter and contain only letters, numbers, _ or -")
		}
		if _, ok := seen[node.ID]; ok {
			v.add(path+".id", "duplicate node id")
		}
		seen[node.ID] = node.Type
		if !supportedNodeTypes[node.Type] {
			v.add(path+".type", "unsupported node type")
			continue
		}
		validateNodeData(v, path, node, opts)
	}
	return seen
}

func validateNodeData(v *validator, path string, node Node, opts ValidationOptions) {
	switch node.Type {
	case "llm":
		prompt, _ := stringField(node.Data, "prompt")
		if strings.TrimSpace(prompt) == "" {
			v.add(path+".data.prompt", "is required")
		} else if err := ValidateTemplateRefs(prompt, opts.MaxTemplateLength); err != nil {
			v.add(path+".data.prompt", err.Error())
		}
	case "agent":
		maxIterations, ok := intField(node.Data, "maxIterations")
		if !ok {
			v.add(path+".data.maxIterations", "is required")
		} else if maxIterations < 1 || maxIterations > 50 {
			v.add(path+".data.maxIterations", "must be between 1 and 50")
		}
	case "tool":
		toolCode, _ := stringField(node.Data, "toolCode")
		if !namePattern.MatchString(toolCode) {
			v.add(path+".data.toolCode", "must be a valid tool code")
		}
	case "extractor":
		mode, _ := stringField(node.Data, "mode")
		if !supportedExtractorModes[mode] {
			v.add(path+".data.mode", "unsupported extractor mode")
		}
		if mode == "regex" {
			pattern, _ := stringField(node.Data, "pattern")
			if pattern == "" {
				v.add(path+".data.pattern", "is required for regex extractor")
			} else if _, err := regexp.Compile(pattern); err != nil {
				v.add(path+".data.pattern", "must be a valid regex")
			}
		}
		if mode == "jsonpath" || mode == "jmespath" {
			expr, _ := stringField(node.Data, "path")
			if strings.TrimSpace(expr) == "" {
				v.add(path+".data.path", "is required")
			}
		}
	case "branch":
		when, _ := stringField(node.Data, "when")
		if strings.TrimSpace(when) == "" {
			v.add(path+".data.when", "is required")
		}
		if strings.ContainsAny(when, "`;$") || strings.Contains(when, "{{") {
			v.add(path+".data.when", "must use the restricted branch expression syntax")
		}
	case "loop":
		over, _ := stringField(node.Data, "over")
		if err := ValidateTemplateRefs(over, opts.MaxTemplateLength); over == "" || err != nil {
			v.add(path+".data.over", "must be a valid template path")
		}
		maxIterations, ok := intField(node.Data, "maxIterations")
		if !ok {
			v.add(path+".data.maxIterations", "is required")
		} else if maxIterations < 1 || maxIterations > opts.MaxLoopIterations {
			v.add(path+".data.maxIterations", fmt.Sprintf("must be between 1 and %d", opts.MaxLoopIterations))
		}
	case "code":
		language, _ := stringField(node.Data, "language")
		if !supportedCodeLanguages[language] {
			v.add(path+".data.language", "must be python or javascript")
		}
		sandboxRef, _ := stringField(node.Data, "sandboxRef")
		if strings.TrimSpace(sandboxRef) == "" {
			v.add(path+".data.sandboxRef", "is required")
		}
		code, _ := stringField(node.Data, "code")
		if len(code) > opts.MaxCodeLength {
			v.add(path+".data.code", fmt.Sprintf("exceeds max length %d", opts.MaxCodeLength))
		}
	}
}

func validateEdges(v *validator, edges []Edge, nodeTypes map[string]string) {
	seen := map[string]bool{}
	for idx, edge := range edges {
		path := fmt.Sprintf("edges[%d]", idx)
		if _, ok := nodeTypes[edge.Source]; !ok {
			v.add(path+".source", "references unknown node")
		}
		if _, ok := nodeTypes[edge.Target]; !ok {
			v.add(path+".target", "references unknown node")
		}
		if edge.Source == edge.Target && edge.Source != "" {
			v.add(path, "self-loop is not allowed")
		}
		key := edge.Source + "->" + edge.Target
		if seen[key] {
			v.add(path, "duplicate edge")
		}
		seen[key] = true
	}
}

func validateAcyclic(v *validator, edges []Edge) {
	graph := map[string][]string{}
	nodes := map[string]bool{}
	for _, edge := range edges {
		graph[edge.Source] = append(graph[edge.Source], edge.Target)
		nodes[edge.Source] = true
		nodes[edge.Target] = true
	}
	order := make([]string, 0, len(nodes))
	for id := range nodes {
		order = append(order, id)
	}
	sort.Strings(order)

	visiting := map[string]bool{}
	visited := map[string]bool{}
	var walk func(string) bool
	walk = func(id string) bool {
		if visiting[id] {
			return true
		}
		if visited[id] {
			return false
		}
		visiting[id] = true
		for _, next := range graph[id] {
			if walk(next) {
				return true
			}
		}
		visiting[id] = false
		visited[id] = true
		return false
	}
	for _, id := range order {
		if walk(id) {
			v.add("edges", "cycle detected")
			return
		}
	}
}

func validateHTTPConnector(v *validator, cfg map[string]any, opts ValidationOptions) {
	method, _ := stringField(cfg, "method")
	method = strings.ToUpper(method)
	if !supportedHTTPMethods[method] {
		v.add("config.method", "unsupported HTTP method")
	}
	rawURL, _ := stringField(cfg, "url")
	if rawURL == "" {
		v.add("config.url", "is required")
	} else if err := ValidatePublicURL(rawURL, opts); err != nil {
		v.add("config.url", err.Error())
	}
}

func stringField(m map[string]any, key string) (string, bool) {
	if m == nil {
		return "", false
	}
	v, ok := m[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

func intField(m map[string]any, key string) (int, bool) {
	if m == nil {
		return 0, false
	}
	switch v := m[key].(type) {
	case int:
		return v, true
	case int32:
		return int(v), true
	case int64:
		return int(v), true
	case float64:
		if v == float64(int(v)) {
			return int(v), true
		}
	}
	return 0, false
}

func isUnsafeHost(host string) bool {
	if host == "localhost" || host == "localhost.localdomain" || host == "metadata.google.internal" {
		return true
	}
	if strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	privateCIDRs := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"100.64.0.0/10",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"::1/128",
		"fc00::/7",
		"fe80::/10",
	}
	for _, cidr := range privateCIDRs {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func looksSensitiveName(value string) bool {
	upper := strings.ToUpper(value)
	for _, marker := range []string{"SECRET", "TOKEN", "PASSWORD", "PASSWD", "API_KEY", "PRIVATE_KEY", "ACCESS_KEY"} {
		if strings.Contains(upper, marker) {
			return true
		}
	}
	return false
}

type validator struct {
	violations []Violation
}

func (v *validator) add(path, message string) {
	v.violations = append(v.violations, Violation{Path: path, Message: message})
}

func (v *validator) err() error {
	if len(v.violations) == 0 {
		return nil
	}
	return &ValidationError{Violations: v.violations}
}
