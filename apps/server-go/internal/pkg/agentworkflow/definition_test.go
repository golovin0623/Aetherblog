package agentworkflow

import (
	"strings"
	"testing"
)

func validDefinition() Definition {
	return Definition{
		Version: 1,
		Name:    "Article Audit",
		Mode:    "fixed",
		Inputs: map[string]InputSpec{
			"post_id": {Type: "integer", Required: true},
		},
		Nodes: []Node{
			{ID: "input_1", Type: "input"},
			{ID: "load", Type: "tool", Data: map[string]any{"toolCode": "kb_get_post"}},
			{ID: "extract_1", Type: "extractor", Data: map[string]any{"mode": "jsonpath", "path": "$.content"}},
			{ID: "agent_1", Type: "agent", Data: map[string]any{"maxIterations": 8}},
			{ID: "answer", Type: "output"},
		},
		Edges: []Edge{
			{Source: "input_1", Target: "load"},
			{Source: "load", Target: "extract_1"},
			{Source: "extract_1", Target: "agent_1"},
			{Source: "agent_1", Target: "answer"},
		},
	}
}

func expectValid(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected valid, got %v", err)
	}
}

func expectInvalid(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected invalid error containing %q", want)
	}
	if want != "" && !strings.Contains(err.Error(), want) {
		t.Fatalf("error %q does not contain %q", err.Error(), want)
	}
}

func TestValidateDefinitionValidCases(t *testing.T) {
	tests := []struct {
		name string
		mut  func(*Definition)
	}{
		{"fixed minimal canvas", nil},
		{"autonomous mode", func(d *Definition) { d.Mode = "autonomous" }},
		{"hybrid mode", func(d *Definition) { d.Mode = "hybrid" }},
		{"no edges draft", func(d *Definition) { d.Edges = nil }},
		{"llm prompt template", func(d *Definition) {
			d.Nodes = append(d.Nodes, Node{ID: "llm_1", Type: "llm", Data: map[string]any{"prompt": "写摘要 {{ inputs.post_id }}"}})
		}},
		{"regex extractor", func(d *Definition) {
			d.Nodes[2] = Node{ID: "extract_1", Type: "extractor", Data: map[string]any{"mode": "regex", "pattern": `(?m)^Title:\s+(.+)$`}}
		}},
		{"loop node", func(d *Definition) {
			d.Nodes = append(d.Nodes, Node{ID: "loop_1", Type: "loop", Data: map[string]any{"over": "{{ inputs.items }}", "maxIterations": 10}})
			d.Inputs["items"] = InputSpec{Type: "array[string]"}
		}},
		{"code node with sandbox", func(d *Definition) {
			d.Nodes = append(d.Nodes, Node{ID: "code_1", Type: "code", Data: map[string]any{"language": "python", "sandboxRef": "default", "code": "def main(x):\n    return x"}})
		}},
		{"branch restricted expression", func(d *Definition) {
			d.Nodes = append(d.Nodes, Node{ID: "branch_1", Type: "branch", Data: map[string]any{"when": "nodes.load.output.score > 0.8"}})
		}},
		{"file input", func(d *Definition) {
			d.Inputs["upload"] = InputSpec{Type: "file"}
		}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			def := validDefinition()
			if tc.mut != nil {
				tc.mut(&def)
			}
			expectValid(t, ValidateDefinition(def, ValidationOptions{}))
		})
	}
}

func TestValidateDefinitionInvalidCases(t *testing.T) {
	tests := []struct {
		name string
		mut  func(*Definition)
		want string
	}{
		{"bad version", func(d *Definition) { d.Version = 2 }, "version"},
		{"empty name", func(d *Definition) { d.Name = "" }, "name"},
		{"bad mode", func(d *Definition) { d.Mode = "chatflow" }, "mode"},
		{"empty nodes", func(d *Definition) { d.Nodes = nil }, "nodes"},
		{"too many nodes", func(d *Definition) {
			d.Nodes = []Node{{ID: "A", Type: "input"}, {ID: "B", Type: "output"}}
		}, "max nodes"},
		{"too many edges", func(d *Definition) {
			d.Edges = []Edge{{Source: "input_1", Target: "load"}, {Source: "load", Target: "extract_1"}}
		}, "max edges"},
		{"invalid input name starts digit", func(d *Definition) { d.Inputs["1bad"] = InputSpec{Type: "string"} }, "input name"},
		{"invalid input type", func(d *Definition) { d.Inputs["bad"] = InputSpec{Type: "secret"} }, "unsupported input type"},
		{"invalid node id starts digit", func(d *Definition) { d.Nodes[0].ID = "1bad" }, "nodes"},
		{"invalid node id character", func(d *Definition) { d.Nodes[0].ID = "bad.dot" }, "nodes"},
		{"duplicate node id", func(d *Definition) { d.Nodes[1].ID = "input_1" }, "duplicate"},
		{"unsupported node type", func(d *Definition) { d.Nodes[1].Type = "unknown" }, "unsupported node type"},
		{"unknown edge source", func(d *Definition) { d.Edges[0].Source = "missing" }, "source"},
		{"unknown edge target", func(d *Definition) { d.Edges[0].Target = "missing" }, "target"},
		{"self loop", func(d *Definition) { d.Edges = append(d.Edges, Edge{Source: "load", Target: "load"}) }, "self-loop"},
		{"duplicate edge", func(d *Definition) { d.Edges = append(d.Edges, d.Edges[0]) }, "duplicate edge"},
		{"cycle", func(d *Definition) { d.Edges = append(d.Edges, Edge{Source: "answer", Target: "input_1"}) }, "cycle"},
		{"autonomous cycle", func(d *Definition) {
			d.Mode = "autonomous"
			d.Edges = append(d.Edges, Edge{Source: "answer", Target: "input_1"})
		}, "cycle"},
		{"hybrid cycle", func(d *Definition) {
			d.Mode = "hybrid"
			d.Edges = append(d.Edges, Edge{Source: "answer", Target: "input_1"})
		}, "cycle"},
		{"llm missing prompt", func(d *Definition) { d.Nodes = []Node{{ID: "llm_1", Type: "llm"}} }, "prompt"},
		{"llm invalid template", func(d *Definition) {
			d.Nodes = []Node{{ID: "llm_1", Type: "llm", Data: map[string]any{"prompt": "{{ exec.bad }}"}}}
		}, "unsupported expression"},
		{"agent missing max iterations", func(d *Definition) {
			d.Nodes = []Node{{ID: "agent_1", Type: "agent"}}
		}, "maxIterations"},
		{"agent zero max iterations", func(d *Definition) {
			d.Nodes = []Node{{ID: "agent_1", Type: "agent", Data: map[string]any{"maxIterations": 0}}}
		}, "between"},
		{"agent too many iterations", func(d *Definition) {
			d.Nodes = []Node{{ID: "agent_1", Type: "agent", Data: map[string]any{"maxIterations": 51}}}
		}, "between"},
		{"tool missing code", func(d *Definition) {
			d.Nodes = []Node{{ID: "tool_1", Type: "tool"}}
		}, "toolCode"},
		{"tool invalid code", func(d *Definition) {
			d.Nodes = []Node{{ID: "tool_1", Type: "tool", Data: map[string]any{"toolCode": "bad code"}}}
		}, "toolCode"},
		{"extractor invalid mode", func(d *Definition) {
			d.Nodes = []Node{{ID: "extract_1", Type: "extractor", Data: map[string]any{"mode": "xpath"}}}
		}, "mode"},
		{"extractor regex missing pattern", func(d *Definition) {
			d.Nodes = []Node{{ID: "extract_1", Type: "extractor", Data: map[string]any{"mode": "regex"}}}
		}, "pattern"},
		{"extractor regex invalid pattern", func(d *Definition) {
			d.Nodes = []Node{{ID: "extract_1", Type: "extractor", Data: map[string]any{"mode": "regex", "pattern": "("}}}
		}, "valid regex"},
		{"extractor jsonpath missing path", func(d *Definition) {
			d.Nodes = []Node{{ID: "extract_1", Type: "extractor", Data: map[string]any{"mode": "jsonpath"}}}
		}, "path"},
		{"extractor jmespath missing path", func(d *Definition) {
			d.Nodes = []Node{{ID: "extract_1", Type: "extractor", Data: map[string]any{"mode": "jmespath"}}}
		}, "path"},
		{"branch missing when", func(d *Definition) {
			d.Nodes = []Node{{ID: "branch_1", Type: "branch"}}
		}, "when"},
		{"branch blocks template", func(d *Definition) {
			d.Nodes = []Node{{ID: "branch_1", Type: "branch", Data: map[string]any{"when": "{{ inputs.x }}"}}}
		}, "restricted"},
		{"branch blocks shell separator", func(d *Definition) {
			d.Nodes = []Node{{ID: "branch_1", Type: "branch", Data: map[string]any{"when": "x; rm -rf /"}}}
		}, "restricted"},
		{"loop missing over", func(d *Definition) {
			d.Nodes = []Node{{ID: "loop_1", Type: "loop", Data: map[string]any{"maxIterations": 5}}}
		}, "over"},
		{"loop invalid over", func(d *Definition) {
			d.Nodes = []Node{{ID: "loop_1", Type: "loop", Data: map[string]any{"over": "{{ call() }}", "maxIterations": 5}}}
		}, "over"},
		{"loop missing max", func(d *Definition) {
			d.Nodes = []Node{{ID: "loop_1", Type: "loop", Data: map[string]any{"over": "{{ inputs.items }}"}}}
		}, "maxIterations"},
		{"loop too many iterations", func(d *Definition) {
			d.Nodes = []Node{{ID: "loop_1", Type: "loop", Data: map[string]any{"over": "{{ inputs.items }}", "maxIterations": 1001}}}
		}, "between"},
		{"code invalid language", func(d *Definition) {
			d.Nodes = []Node{{ID: "code_1", Type: "code", Data: map[string]any{"language": "bash", "sandboxRef": "default"}}}
		}, "language"},
		{"code missing sandbox", func(d *Definition) {
			d.Nodes = []Node{{ID: "code_1", Type: "code", Data: map[string]any{"language": "python"}}}
		}, "sandboxRef"},
		{"code too long", func(d *Definition) {
			d.Nodes = []Node{{ID: "code_1", Type: "code", Data: map[string]any{"language": "python", "sandboxRef": "default", "code": strings.Repeat("x", 11)}}}
		}, "max length"},
		{"non integer max iteration rejected", func(d *Definition) {
			d.Nodes = []Node{{ID: "agent_1", Type: "agent", Data: map[string]any{"maxIterations": 1.5}}}
		}, "maxIterations"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			def := validDefinition()
			tc.mut(&def)
			opts := ValidationOptions{MaxNodes: 20, MaxEdges: 20, MaxCodeLength: 10}
			if tc.name == "too many nodes" {
				opts.MaxNodes = 1
			}
			if tc.name == "too many edges" {
				opts.MaxEdges = 1
			}
			expectInvalid(t, ValidateDefinition(def, opts), tc.want)
		})
	}
}

func TestValidateTemplateRefs(t *testing.T) {
	valid := []string{
		"plain text",
		"{{ inputs.post_id }}",
		"{{ system.now }}",
		"{{ user.id }}",
		"{{ workflow.name }}",
		"{{ run.id }}",
		"{{ nodes.load.output }}",
		"{{ nodes.items[0].title }}",
		"prefix {{ inputs.query }} suffix",
		"{{ env.PUBLIC_VALUE }}",
		"{{ inputs.items[12].name }}",
		"{{ nodes.node_1.output.summary }}",
	}
	for _, input := range valid {
		t.Run("valid "+input, func(t *testing.T) {
			expectValid(t, ValidateTemplateRefs(input, 1000))
		})
	}

	invalid := []string{
		"{{ }}",
		"{{ exec('ls') }}",
		"{{ open.file }}",
		"{{ inputs..bad }}",
		"{{ inputs.bad-name }}",
		"{{ inputs[bad] }}",
		"{{ process.env.SECRET }}",
		"{{ constructor.prototype }}",
		"{{ nodes.load.output | safe }}",
		"{{ inputs.x + inputs.y }}",
		"{{ inputs.x() }}",
		"{{ $.jsonpath }}",
		"{{ this }}",
		"{{ __proto__.polluted }}",
		"{{ inputs.中文 }}",
		"{{ env.SECRET_KEY }}",
		"{{ workflow['name'] }}",
		"{{ nodes.load.output;drop }}",
	}
	for _, input := range invalid {
		t.Run("invalid "+input, func(t *testing.T) {
			expectInvalid(t, ValidateTemplateRefs(input, 1000), "template")
		})
	}

	t.Run("too long", func(t *testing.T) {
		expectInvalid(t, ValidateTemplateRefs(strings.Repeat("x", 12), 10), "max length")
	})
}

func TestValidatePublicURL(t *testing.T) {
	valid := []string{
		"https://example.com",
		"https://api.example.com/v1/search",
		"https://example.com:8443/path?x=1",
		"https://xn--fsqu00a.xn--0zwm56d",
		"http://example.com",
	}
	for _, raw := range valid {
		t.Run("valid "+raw, func(t *testing.T) {
			opts := ValidationOptions{}
			if strings.HasPrefix(raw, "http://") {
				opts.AllowHTTP = true
			}
			expectValid(t, ValidatePublicURL(raw, opts))
		})
	}

	invalid := []string{
		"",
		"example.com",
		"ftp://example.com/file",
		"http://example.com",
		"https://localhost",
		"https://localhost.localdomain",
		"https://127.0.0.1",
		"https://0.0.0.0",
		"https://10.0.0.1",
		"https://172.16.0.1",
		"https://172.31.255.255",
		"https://192.168.1.1",
		"https://169.254.169.254/latest/meta-data",
		"https://100.64.0.1",
		"https://[::1]",
		"https://[fc00::1]",
		"https://[fe80::1]",
		"https://service.local",
		"https://metadata.google.internal",
		"https://service.internal",
	}
	for _, raw := range invalid {
		t.Run("invalid "+raw, func(t *testing.T) {
			expectInvalid(t, ValidatePublicURL(raw, ValidationOptions{}), "")
		})
	}

	t.Run("local allowed only explicit", func(t *testing.T) {
		expectValid(t, ValidatePublicURL("http://127.0.0.1:3000", ValidationOptions{AllowHTTP: true, AllowLocalHTTP: true}))
	})
}

func TestValidateVariable(t *testing.T) {
	valid := []VariableSpec{
		{Name: "public_timeout", Scope: "workflow", Type: "integer", Value: 30},
		{Name: "run_payload", Scope: "run", Type: "object", Value: map[string]any{"ok": true}},
		{Name: "system_model", Scope: "system", Type: "string", Value: "gpt-5-mini"},
		{Name: "user_flag", Scope: "user", Type: "boolean", Value: true},
		{Name: "api_key", Scope: "workflow", Type: "string", SecretRef: "secret:agent/openai"},
		{Name: "files", Scope: "run", Type: "array[object]", Value: []any{}},
	}
	for _, spec := range valid {
		t.Run("valid "+spec.Name, func(t *testing.T) {
			expectValid(t, ValidateVariable(spec))
		})
	}

	invalid := []struct {
		name string
		spec VariableSpec
		want string
	}{
		{"bad name", VariableSpec{Name: "1bad", Scope: "run", Type: "string"}, "name"},
		{"bad scope", VariableSpec{Name: "x", Scope: "global", Type: "string"}, "scope"},
		{"bad type", VariableSpec{Name: "x", Scope: "run", Type: "secret"}, "type"},
		{"bad secret scheme", VariableSpec{Name: "x", Scope: "run", Type: "string", SecretRef: "plain"}, "secretRef"},
		{"secret with value", VariableSpec{Name: "x", Scope: "run", Type: "string", SecretRef: "secret:a/b", Value: "leak"}, "value"},
		{"secret too short", VariableSpec{Name: "x", Scope: "run", Type: "string", SecretRef: "secret:a"}, "secretRef"},
		{"empty name", VariableSpec{Name: "", Scope: "run", Type: "string"}, "name"},
		{"empty scope", VariableSpec{Name: "x", Type: "string"}, "scope"},
		{"empty type", VariableSpec{Name: "x", Scope: "run"}, "type"},
		{"bad secret char", VariableSpec{Name: "x", Scope: "run", Type: "string", SecretRef: "secret:a b"}, "secretRef"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			expectInvalid(t, ValidateVariable(tc.spec), tc.want)
		})
	}
}

func TestValidateConnector(t *testing.T) {
	valid := []ConnectorSpec{
		{Code: "builtin_search", Protocol: "builtin"},
		{Code: "http_search", Protocol: "http", Config: map[string]any{"method": "POST", "url": "https://api.example.com/search"}},
		{Code: "http_get", Protocol: "http", Config: map[string]any{"method": "GET", "url": "https://api.example.com/search"}},
		{Code: "openapi_catalog", Protocol: "openapi", Config: map[string]any{"schemaUrl": "https://api.example.com/openapi.json"}},
		{Code: "mcp_remote", Protocol: "mcp", Config: map[string]any{"transport": "streamable_http", "url": "https://mcp.example.com/mcp"}},
		{Code: "mcp_stdio", Protocol: "mcp", Config: map[string]any{"transport": "stdio"}},
		{Code: "skill_security", Protocol: "skill", Config: map[string]any{"path": "security-audit/SKILL.md"}},
		{Code: "skill_nested", Protocol: "skill", Config: map[string]any{"path": "team/custom/SKILL.md"}},
	}
	for _, spec := range valid {
		t.Run("valid "+spec.Code, func(t *testing.T) {
			expectValid(t, ValidateConnector(spec, ValidationOptions{}))
		})
	}

	invalid := []struct {
		name string
		spec ConnectorSpec
		want string
	}{
		{"bad code", ConnectorSpec{Code: "bad code", Protocol: "builtin"}, "code"},
		{"bad protocol", ConnectorSpec{Code: "x", Protocol: "grpc"}, "protocol"},
		{"http missing method", ConnectorSpec{Code: "x", Protocol: "http", Config: map[string]any{"url": "https://api.example.com"}}, "method"},
		{"http bad method", ConnectorSpec{Code: "x", Protocol: "http", Config: map[string]any{"method": "TRACE", "url": "https://api.example.com"}}, "method"},
		{"http missing url", ConnectorSpec{Code: "x", Protocol: "http", Config: map[string]any{"method": "POST"}}, "url"},
		{"http private url", ConnectorSpec{Code: "x", Protocol: "http", Config: map[string]any{"method": "POST", "url": "https://127.0.0.1"}}, "url"},
		{"http ftp url", ConnectorSpec{Code: "x", Protocol: "http", Config: map[string]any{"method": "POST", "url": "ftp://example.com"}}, "url"},
		{"openapi missing url", ConnectorSpec{Code: "x", Protocol: "openapi"}, "schemaUrl"},
		{"openapi internal url", ConnectorSpec{Code: "x", Protocol: "openapi", Config: map[string]any{"schemaUrl": "https://service.local/openapi.json"}}, "schemaUrl"},
		{"mcp missing transport", ConnectorSpec{Code: "x", Protocol: "mcp"}, "transport"},
		{"mcp bad transport", ConnectorSpec{Code: "x", Protocol: "mcp", Config: map[string]any{"transport": "websocket"}}, "transport"},
		{"mcp stream missing url", ConnectorSpec{Code: "x", Protocol: "mcp", Config: map[string]any{"transport": "streamable_http"}}, "url"},
		{"mcp stream internal url", ConnectorSpec{Code: "x", Protocol: "mcp", Config: map[string]any{"transport": "streamable_http", "url": "https://10.0.0.2/mcp"}}, "url"},
		{"skill missing path", ConnectorSpec{Code: "x", Protocol: "skill"}, "path"},
		{"skill absolute path", ConnectorSpec{Code: "x", Protocol: "skill", Config: map[string]any{"path": "/tmp/SKILL.md"}}, "path"},
		{"skill traversal", ConnectorSpec{Code: "x", Protocol: "skill", Config: map[string]any{"path": "../secret/SKILL.md"}}, "path"},
		{"empty connector", ConnectorSpec{}, "code"},
		{"http url not string", ConnectorSpec{Code: "x", Protocol: "http", Config: map[string]any{"method": "POST", "url": 123}}, "url"},
		{"openapi url not string", ConnectorSpec{Code: "x", Protocol: "openapi", Config: map[string]any{"schemaUrl": 123}}, "schemaUrl"},
		{"mcp url not string", ConnectorSpec{Code: "x", Protocol: "mcp", Config: map[string]any{"transport": "streamable_http", "url": 123}}, "url"},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			expectInvalid(t, ValidateConnector(tc.spec, ValidationOptions{}), tc.want)
		})
	}
}
