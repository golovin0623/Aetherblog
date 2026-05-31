// Package service 是 Atlas 域的业务逻辑层。
//
// Phase 0 仅暴露最小 health 能力。Phase 1 起按子域拆 carrier_service / annotation_service /
// kp_service / relation_service，遵循「Atlas 的标注 != 知识点」铁律。
package service

import (
	"context"

	"github.com/golovin0623/aetherblog-server/internal/knowledge/repository"
)

// AtlasService 聚合 Atlas 子域的业务编排入口。
type AtlasService struct {
	repo      *repository.AtlasRepo
	carriers  *repository.CarrierRepo
	markdown  *MarkdownCarrierService
	pdf       *PdfCarrierService
	blogPosts *BlogPostCarrierService
}

// NewAtlasService 创建 AtlasService。
//
// markdown 适配器可以为 nil（Phase 0 兼容）。Phase 1 起 server.go 必须传入。
func NewAtlasService(repo *repository.AtlasRepo, markdown *MarkdownCarrierService) *AtlasService {
	var carriers *repository.CarrierRepo
	if markdown != nil {
		carriers = markdown.carriers
	} else {
		carriers = repository.NewCarrierRepo(repo)
	}
	return &AtlasService{repo: repo, carriers: carriers, markdown: markdown}
}

// HealthCheck 是 admin /atlas/health 的实际后端。
// Phase 0 校验 atlas_carriers 表可访问 → migrations 落库成功。
func (s *AtlasService) HealthCheck(ctx context.Context) error {
	return s.repo.Ping(ctx)
}

// Markdown 返回 Markdown 子服务（懒创建 / 内容指纹追踪）。Phase 1+ 用。
func (s *AtlasService) Markdown() *MarkdownCarrierService {
	return s.markdown
}

// AttachPDF injects the PDF carrier service after media dependencies are wired.
func (s *AtlasService) AttachPDF(pdf *PdfCarrierService) {
	s.pdf = pdf
}

// PDF 返回 PDF 子服务（媒体文件 → 文本层 carrier）。
func (s *AtlasService) PDF() *PdfCarrierService {
	return s.pdf
}

// AttachBlogPosts injects the blog-post carrier service after post dependencies are wired.
func (s *AtlasService) AttachBlogPosts(blogPosts *BlogPostCarrierService) {
	s.blogPosts = blogPosts
}

// BlogPosts 返回 Blog post 子服务（posts 表 → carrier）。
func (s *AtlasService) BlogPosts() *BlogPostCarrierService {
	return s.blogPosts
}

// Carriers 返回 CarrierRepo（CRUD）。Phase 1+ 由 handler 调。
func (s *AtlasService) Carriers() *repository.CarrierRepo {
	return s.carriers
}
