package service

import (
	"testing"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
)

func i64(v int64) *int64 { return &v }

// TestBuildCategoryTree_NestedStructure 验证分类树按 parent_id 正确组装多级嵌套，
// 并确保顶级节点收集与子节点挂载互不串扰。
func TestBuildCategoryTree_NestedStructure(t *testing.T) {
	cats := []model.Category{
		{ID: 1, Name: "root-a", ParentID: nil},
		{ID: 2, Name: "child-a1", ParentID: i64(1)},
		{ID: 3, Name: "grandchild-a1", ParentID: i64(2)},
		{ID: 4, Name: "root-b", ParentID: nil},
	}

	tree := buildCategoryTree(cats)

	if len(tree) != 2 {
		t.Fatalf("expected 2 roots, got %d", len(tree))
	}
	var rootA *dto.CategoryVO
	for i := range tree {
		if tree[i].ID == 1 {
			rootA = &tree[i]
		}
	}
	if rootA == nil {
		t.Fatal("root-a (id=1) not found in tree")
	}
	if len(rootA.Children) != 1 || rootA.Children[0].ID != 2 {
		t.Fatalf("expected root-a to have child id=2, got %+v", rootA.Children)
	}
	// 深层嵌套：孙级必须被保留
	if len(rootA.Children[0].Children) != 1 || rootA.Children[0].Children[0].ID != 3 {
		t.Fatalf("expected grandchild id=3 under child id=2, got %+v", rootA.Children[0].Children)
	}
}

func TestBuildCategoryTree_Empty(t *testing.T) {
	if got := buildCategoryTree(nil); got != nil {
		t.Fatalf("expected nil for empty input, got %+v", got)
	}
}

// TestBuildFolderTree_DeepNesting 回归测试：原两轮指针挂载方案在值拷贝下会丢失
// 孙级及更深层级。这里构造 4 级嵌套，确保最深层节点完整保留。
func TestBuildFolderTree_DeepNesting(t *testing.T) {
	vos := []dto.MediaFolderVO{
		{ID: 1, Name: "L0", ParentID: nil},
		{ID: 2, Name: "L1", ParentID: i64(1)},
		{ID: 3, Name: "L2", ParentID: i64(2)},
		{ID: 4, Name: "L3", ParentID: i64(3)},
	}

	tree := buildFolderTree(vos)

	if len(tree) != 1 || tree[0].ID != 1 {
		t.Fatalf("expected single root id=1, got %+v", tree)
	}
	node := &tree[0]
	for _, wantID := range []int64{2, 3, 4} {
		if len(node.Children) != 1 {
			t.Fatalf("expected exactly 1 child at level toward id=%d, got %+v", wantID, node.Children)
		}
		if node.Children[0].ID != wantID {
			t.Fatalf("expected child id=%d, got %d", wantID, node.Children[0].ID)
		}
		node = &node.Children[0]
	}
}
