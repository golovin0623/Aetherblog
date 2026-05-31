package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
)

const (
	defaultWebClipFetchTimeout = 8 * time.Second
	defaultWebClipMaxBytes     = 1 << 20
	minReadableWebClipChars    = 40
)

// WebClipSnapshot is the fetched, readable web page draft shown before carrier creation.
type WebClipSnapshot struct {
	SourceURL       string
	Title           string
	ContentMarkdown string
	Author          *string
	Language        *string
}

// WebClipFetcher fetches and extracts a safe bounded readable HTML snapshot.
type WebClipFetcher struct {
	client   *http.Client
	lookupIP func(context.Context, string) ([]netip.Addr, error)
	maxBytes int64
}

// DefaultWebClipFetcher creates the production fetcher with timeouts and redirect validation.
func DefaultWebClipFetcher() *WebClipFetcher {
	return &WebClipFetcher{
		client:   defaultWebClipHTTPClient(),
		lookupIP: defaultLookupNetIP,
		maxBytes: defaultWebClipMaxBytes,
	}
}

// Fetch downloads a public http(s) HTML page and returns a readable Markdown draft.
func (f *WebClipFetcher) Fetch(ctx context.Context, rawURL string) (*WebClipSnapshot, error) {
	normalized, err := normalizeFetchWebClipURL(rawURL)
	if err != nil {
		return nil, err
	}
	lookup := f.lookupIP
	if lookup == nil {
		lookup = defaultLookupNetIP
	}
	if err := validateFetchTarget(ctx, normalized, lookup); err != nil {
		return nil, err
	}

	client := http.Client{Timeout: defaultWebClipFetchTimeout}
	if f.client != nil {
		client = *f.client
	}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("web capture redirect too deep")
		}
		redirected, err := normalizeFetchWebClipURL(req.URL.String())
		if err != nil {
			return err
		}
		return validateFetchTarget(req.Context(), redirected, lookup)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalized, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "AetherBlog-Atlas-WebClip/1.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("抓取网页失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("网页返回状态码 %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if !isReadableHTMLContentType(contentType) {
		return nil, fmt.Errorf("网页内容类型不支持: %s", firstNonEmpty(contentType, "unknown"))
	}

	maxBytes := f.maxBytes
	if maxBytes <= 0 {
		maxBytes = defaultWebClipMaxBytes
	}
	limited := io.LimitReader(resp.Body, maxBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("读取网页响应失败: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("网页响应超过 %d bytes", maxBytes)
	}
	finalURL := normalized
	if resp.Request != nil && resp.Request.URL != nil {
		if value, err := NormalizeWebClipSourceURI(resp.Request.URL.String()); err == nil {
			finalURL = value
		}
	}
	return ExtractReadableWebSnapshot(finalURL, bytes.NewReader(data), contentType)
}

// ExtractReadableWebSnapshot parses a bounded HTML document into title/author/lang/text.
func ExtractReadableWebSnapshot(sourceURL string, body io.Reader, contentType string) (*WebClipSnapshot, error) {
	if !isReadableHTMLContentType(contentType) {
		return nil, fmt.Errorf("网页内容类型不支持: %s", firstNonEmpty(contentType, "unknown"))
	}
	root, err := html.Parse(body)
	if err != nil {
		return nil, fmt.Errorf("解析 HTML 失败: %w", err)
	}
	title := firstNonEmpty(findTitle(root), firstHeading(root))
	author := trimmedOptional(findMetaContent(root, "author"))
	language := trimmedOptional(findLanguage(root))
	content := readableMarkdown(root)
	if len([]rune(strings.TrimSpace(content))) < minReadableWebClipChars {
		return nil, errors.New("网页正文过短，无法生成可用快照")
	}
	if title == "" {
		title = sourceURL
	}
	return &WebClipSnapshot{
		SourceURL:       sourceURL,
		Title:           title,
		ContentMarkdown: content,
		Author:          author,
		Language:        language,
	}, nil
}

func normalizeFetchWebClipURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed == nil {
		return "", errors.New("sourceUrl 必须是完整的 http(s) URL")
	}
	if parsed.User != nil {
		return "", errors.New("sourceUrl 不支持 userinfo")
	}
	return NormalizeWebClipSourceURI(trimmed)
}

func validateFetchTarget(ctx context.Context, normalizedURL string, lookup func(context.Context, string) ([]netip.Addr, error)) error {
	parsed, err := url.Parse(normalizedURL)
	if err != nil {
		return err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return errors.New("sourceUrl 仅支持 http(s)")
	}
	if parsed.Port() != "" {
		if parsed.Scheme == "http" && parsed.Port() != "80" {
			return errors.New("http URL 仅允许默认 80 端口")
		}
		if parsed.Scheme == "https" && parsed.Port() != "443" {
			return errors.New("https URL 仅允许默认 443 端口")
		}
	}
	host := parsed.Hostname()
	if host == "" {
		return errors.New("sourceUrl host 不能为空")
	}
	return validateFetchHost(ctx, host, lookup)
}

func validateFetchHost(ctx context.Context, host string, lookup func(context.Context, string) ([]netip.Addr, error)) error {
	if addr, err := netip.ParseAddr(host); err == nil {
		if !isPublicFetchAddr(addr) {
			return errors.New("sourceUrl 指向非公网地址")
		}
		return nil
	}
	addrs, err := lookup(ctx, host)
	if err != nil {
		return fmt.Errorf("解析网页 host 失败: %w", err)
	}
	if len(addrs) == 0 {
		return errors.New("网页 host 没有可用地址")
	}
	for _, addr := range addrs {
		if !isPublicFetchAddr(addr) {
			return errors.New("sourceUrl 解析到非公网地址")
		}
	}
	return nil
}

func defaultLookupNetIP(ctx context.Context, host string) ([]netip.Addr, error) {
	return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
}

func defaultWebClipHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network string, address string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		if err := validateFetchHost(ctx, host, defaultLookupNetIP); err != nil {
			return nil, err
		}
		conn, err := dialer.DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		if addr := remoteNetipAddr(conn); addr.IsValid() && !isPublicFetchAddr(addr) {
			conn.Close()
			return nil, errors.New("sourceUrl connected to non-public address")
		}
		return conn, nil
	}
	return &http.Client{Timeout: defaultWebClipFetchTimeout, Transport: transport}
}

func isPublicFetchAddr(addr netip.Addr) bool {
	addr = addr.Unmap()
	return addr.IsValid() &&
		!addr.IsUnspecified() &&
		!addr.IsLoopback() &&
		!addr.IsPrivate() &&
		!addr.IsLinkLocalUnicast() &&
		!addr.IsMulticast()
}

func remoteNetipAddr(conn net.Conn) netip.Addr {
	tcp, ok := conn.RemoteAddr().(*net.TCPAddr)
	if !ok {
		return netip.Addr{}
	}
	addr, ok := netip.AddrFromSlice(tcp.IP)
	if !ok {
		return netip.Addr{}
	}
	return addr
}

func isReadableHTMLContentType(value string) bool {
	if strings.TrimSpace(value) == "" {
		return true
	}
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	}
	return mediaType == "text/html" || mediaType == "application/xhtml+xml"
}

func findTitle(root *html.Node) string {
	var out string
	walkHTML(root, func(n *html.Node) bool {
		if out != "" {
			return false
		}
		if n.Type == html.ElementNode && strings.EqualFold(n.Data, "title") {
			out = normalizeReadableText(nodeText(n))
			return false
		}
		return true
	})
	return out
}

func firstHeading(root *html.Node) string {
	var out string
	walkHTML(root, func(n *html.Node) bool {
		if out != "" {
			return false
		}
		if n.Type == html.ElementNode && headingPrefix(n.Data) != "" {
			out = normalizeReadableText(nodeText(n))
			return false
		}
		return true
	})
	return out
}

func findMetaContent(root *html.Node, name string) string {
	var out string
	walkHTML(root, func(n *html.Node) bool {
		if out != "" {
			return false
		}
		if n.Type != html.ElementNode || !strings.EqualFold(n.Data, "meta") {
			return true
		}
		if strings.EqualFold(attr(n, "name"), name) || strings.EqualFold(attr(n, "property"), name) {
			out = normalizeReadableText(attr(n, "content"))
			return false
		}
		return true
	})
	return out
}

func findLanguage(root *html.Node) string {
	var out string
	walkHTML(root, func(n *html.Node) bool {
		if out != "" {
			return false
		}
		if n.Type == html.ElementNode && strings.EqualFold(n.Data, "html") {
			out = normalizeReadableText(attr(n, "lang"))
			return false
		}
		return true
	})
	if out == "" {
		out = firstNonEmpty(findMetaContent(root, "language"), findMetaContent(root, "og:locale"))
	}
	return out
}

func readableMarkdown(root *html.Node) string {
	source := firstReadableRoot(root)
	if source == nil {
		source = root
	}
	blocks := make([]string, 0, 16)
	collectReadableBlocks(source, &blocks)
	if len(blocks) == 0 {
		if text := normalizeReadableText(nodeText(source)); text != "" {
			blocks = append(blocks, text)
		}
	}
	return strings.TrimSpace(strings.Join(blocks, "\n\n"))
}

func firstReadableRoot(root *html.Node) *html.Node {
	var fallback *html.Node
	var body *html.Node
	for _, tag := range []string{"article", "main"} {
		var found *html.Node
		walkHTML(root, func(n *html.Node) bool {
			if found != nil {
				return false
			}
			if n.Type == html.ElementNode && strings.EqualFold(n.Data, tag) && normalizeReadableText(nodeText(n)) != "" {
				found = n
				return false
			}
			return true
		})
		if found != nil {
			return found
		}
	}
	walkHTML(root, func(n *html.Node) bool {
		if n.Type == html.ElementNode && strings.EqualFold(n.Data, "body") {
			body = n
			return false
		}
		return true
	})
	if body != nil {
		fallback = body
	}
	return fallback
}

func collectReadableBlocks(n *html.Node, blocks *[]string) {
	if n == nil || shouldSkipHTMLNode(n) {
		return
	}
	if n.Type == html.ElementNode {
		tag := strings.ToLower(n.Data)
		if prefix := headingPrefix(tag); prefix != "" {
			if text := normalizeReadableText(nodeText(n)); text != "" {
				*blocks = append(*blocks, prefix+text)
			}
			return
		}
		switch tag {
		case "p":
			if text := normalizeReadableText(nodeText(n)); text != "" {
				*blocks = append(*blocks, text)
			}
			return
		case "li":
			if text := normalizeReadableText(nodeText(n)); text != "" {
				*blocks = append(*blocks, "- "+text)
			}
			return
		case "blockquote":
			if text := normalizeReadableText(nodeText(n)); text != "" {
				*blocks = append(*blocks, "> "+text)
			}
			return
		}
	}
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		collectReadableBlocks(child, blocks)
	}
}

func nodeText(n *html.Node) string {
	var parts []string
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node == nil || shouldSkipHTMLNode(node) {
			return
		}
		if node.Type == html.TextNode {
			parts = append(parts, node.Data)
			return
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(n)
	return strings.Join(parts, " ")
}

func shouldSkipHTMLNode(n *html.Node) bool {
	if n.Type != html.ElementNode {
		return false
	}
	switch strings.ToLower(n.Data) {
	case "script", "style", "noscript", "svg", "canvas", "nav", "header", "footer", "aside", "form", "iframe":
		return true
	default:
		return false
	}
}

func headingPrefix(tag string) string {
	switch strings.ToLower(tag) {
	case "h1":
		return "# "
	case "h2":
		return "## "
	case "h3":
		return "### "
	case "h4":
		return "#### "
	case "h5":
		return "##### "
	case "h6":
		return "###### "
	default:
		return ""
	}
}

func walkHTML(n *html.Node, visit func(*html.Node) bool) {
	if n == nil {
		return
	}
	if !visit(n) {
		return
	}
	for child := n.FirstChild; child != nil; child = child.NextSibling {
		walkHTML(child, visit)
	}
}

func attr(n *html.Node, key string) string {
	for _, item := range n.Attr {
		if strings.EqualFold(item.Key, key) {
			return item.Val
		}
	}
	return ""
}

func normalizeReadableText(value string) string {
	return strings.Join(strings.Fields(html.UnescapeString(value)), " ")
}

func trimmedOptional(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
