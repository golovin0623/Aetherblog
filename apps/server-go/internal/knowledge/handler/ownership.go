package handler

import (
	"fmt"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

func cloneAtlasAuthorID(id *int64) *int64 {
	if id == nil {
		return nil
	}
	v := *id
	return &v
}

func commonAtlasAuthorID(label string, fallback *int64, ids ...*int64) (*int64, error) {
	var common *int64
	for _, id := range ids {
		if id == nil {
			continue
		}
		if common == nil {
			common = cloneAtlasAuthorID(id)
			continue
		}
		if *common != *id {
			return nil, atlasError(response.BadRequest, fmt.Sprintf("%s owner 不一致", label))
		}
	}
	if common != nil {
		return common, nil
	}
	return cloneAtlasAuthorID(fallback), nil
}
