package handler

import (
	"fmt"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// AccessHandler 处理用户、角色、团队和内容共享相关的管理 API。
type AccessHandler struct {
	svc         *service.AccessService
	activitySvc *service.ActivityService
}

// NewAccessHandler 创建 AccessHandler。
func NewAccessHandler(svc *service.AccessService, activitySvc *service.ActivityService) *AccessHandler {
	return &AccessHandler{svc: svc, activitySvc: activitySvc}
}

// Mount 注册身份访问模块路由。
func (h *AccessHandler) Mount(g *echo.Group, require func(permissionCode string) echo.MiddlewareFunc) {
	users := g.Group("/users")
	users.GET("", h.ListUsers, require("system.users.view"))
	users.POST("", h.CreateUser, require("system.users.manage"))
	users.PUT("/:id", h.UpdateUser, require("system.users.manage"))
	users.PUT("/:id/roles", h.AssignRoles, require("system.users.manage"))
	users.POST("/:id/reset-password", h.ResetPassword, require("system.users.manage"))

	g.GET("/roles", h.ListRoles, require("system.users.view"))
	g.PUT("/roles/:id/permissions", h.UpdateRolePermissions, require("system.roles.manage"))
	g.GET("/permissions", h.ListPermissions, require("system.users.view"))

	teams := g.Group("/teams")
	teams.GET("", h.ListTeams, require("system.teams.manage"))
	teams.POST("", h.CreateTeam, require("system.teams.manage"))
	teams.PUT("/:id", h.UpdateTeam, require("system.teams.manage"))
	teams.GET("/:id/members", h.ListTeamMembers, require("system.teams.manage"))
	teams.POST("/:id/members", h.UpsertTeamMember, require("system.teams.manage"))
	teams.DELETE("/:id/members/:userId", h.RemoveTeamMember, require("system.teams.manage"))

	shares := g.Group("/content-shares")
	shares.GET("", h.ListContentShares, require("content.shares.manage"))
	shares.GET("/resources", h.ListShareableResources, require("content.shares.manage"))
	shares.POST("", h.CreateContentShare, require("content.shares.manage"))
	shares.POST("/batch", h.BatchCreateContentShares, require("content.shares.manage"))
	shares.DELETE("/:id", h.DeleteContentShare, require("content.shares.manage"))
}

func (h *AccessHandler) ListUsers(c echo.Context) error {
	filter := repository.UserListFilter{
		Search:   c.QueryParam("search"),
		RoleCode: c.QueryParam("role"),
		Status:   c.QueryParam("status"),
		PageNum:  parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize: parseIntDefault(c.QueryParam("pageSize"), 20),
	}
	pr, err := h.svc.ListUsers(c.Request().Context(), filter)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

func (h *AccessHandler) CreateUser(c echo.Context) error {
	var req dto.CreateManagedUserRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.CreateUser(c.Request().Context(), req, actorID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.recordAccessActivity(c, "user.create", "创建用户: "+req.Username, fmt.Sprintf("用户 #%d 已创建", vo.ID))
	return response.OK(c, vo)
}

func (h *AccessHandler) UpdateUser(c echo.Context) error {
	id, err := parseIDParam(c, "id", "无效的用户ID")
	if err != nil {
		return err
	}
	var req dto.UpdateManagedUserRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.UpdateUser(c.Request().Context(), id, req, actorID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "用户不存在")
	}
	h.recordAccessActivity(c, "user.update", fmt.Sprintf("更新用户 #%d", id), "用户资料、状态或角色已更新")
	return response.OK(c, vo)
}

func (h *AccessHandler) AssignRoles(c echo.Context) error {
	id, err := parseIDParam(c, "id", "无效的用户ID")
	if err != nil {
		return err
	}
	var req dto.AssignUserRolesRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.AssignRoles(c.Request().Context(), id, req, actorID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "用户不存在")
	}
	h.recordAccessActivity(c, "user.roles_update", fmt.Sprintf("更新用户 #%d 角色", id), "用户角色授权已更新")
	return response.OK(c, vo)
}

func (h *AccessHandler) ResetPassword(c echo.Context) error {
	id, err := parseIDParam(c, "id", "无效的用户ID")
	if err != nil {
		return err
	}
	var req dto.ResetUserPasswordRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.ResetPassword(c.Request().Context(), id, req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.recordAccessActivity(c, "user.password_reset", fmt.Sprintf("重置用户 #%d 密码", id), "管理员已重置用户密码")
	return response.OKEmpty(c)
}

func (h *AccessHandler) ListRoles(c echo.Context) error {
	roles, err := h.svc.ListRoles(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, roles)
}

func (h *AccessHandler) ListPermissions(c echo.Context) error {
	perms, err := h.svc.ListPermissions(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, perms)
}

func (h *AccessHandler) UpdateRolePermissions(c echo.Context) error {
	id, err := parseIDParam(c, "id", "无效的角色ID")
	if err != nil {
		return err
	}
	var req dto.UpdateRolePermissionsRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	role, err := h.svc.UpdateRolePermissions(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if role == nil {
		return response.FailWith(c, response.NotFound, "角色不存在")
	}
	h.recordAccessActivity(c, "role.permissions_update", fmt.Sprintf("更新角色 #%d 权限", id), "角色权限集合已更新")
	return response.OK(c, role)
}

func (h *AccessHandler) ListTeams(c echo.Context) error {
	teams, err := h.svc.ListTeams(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, teams)
}

func (h *AccessHandler) CreateTeam(c echo.Context) error {
	var req dto.CreateTeamRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	team, err := h.svc.CreateTeam(c.Request().Context(), req, actorID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.recordAccessActivity(c, "team.create", "创建团队: "+req.Name, fmt.Sprintf("团队 #%d 已创建", team.ID))
	return response.OK(c, team)
}

func (h *AccessHandler) UpdateTeam(c echo.Context) error {
	id, err := parseIDParam(c, "id", "无效的团队ID")
	if err != nil {
		return err
	}
	var req dto.UpdateTeamRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	team, err := h.svc.UpdateTeam(c.Request().Context(), id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if team == nil {
		return response.FailWith(c, response.NotFound, "团队不存在")
	}
	h.recordAccessActivity(c, "team.update", fmt.Sprintf("更新团队 #%d", id), "团队资料已更新")
	return response.OK(c, team)
}

func (h *AccessHandler) ListTeamMembers(c echo.Context) error {
	teamID, err := parseIDParam(c, "id", "无效的团队ID")
	if err != nil {
		return err
	}
	members, err := h.svc.ListTeamMembers(c.Request().Context(), teamID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, members)
}

func (h *AccessHandler) UpsertTeamMember(c echo.Context) error {
	teamID, err := parseIDParam(c, "id", "无效的团队ID")
	if err != nil {
		return err
	}
	var req dto.UpsertTeamMemberRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	member, err := h.svc.UpsertTeamMember(c.Request().Context(), teamID, req, actorID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.recordAccessActivity(c, "team.member_upsert", fmt.Sprintf("维护团队 #%d 成员", teamID), fmt.Sprintf("用户 #%d 的团队角色已更新", req.UserID))
	return response.OK(c, member)
}

func (h *AccessHandler) RemoveTeamMember(c echo.Context) error {
	teamID, err := parseIDParam(c, "id", "无效的团队ID")
	if err != nil {
		return err
	}
	userID, err := parseIDParam(c, "userId", "无效的用户ID")
	if err != nil {
		return err
	}
	if err := h.svc.RemoveTeamMember(c.Request().Context(), teamID, userID); err != nil {
		return response.Error(c, err)
	}
	h.recordAccessActivity(c, "team.member_remove", fmt.Sprintf("移除团队 #%d 成员", teamID), fmt.Sprintf("用户 #%d 已移出团队", userID))
	return response.OKEmpty(c)
}

func (h *AccessHandler) ListContentShares(c echo.Context) error {
	filter := repository.ContentShareFilter{
		ResourceType:  c.QueryParam("resourceType"),
		PrincipalType: c.QueryParam("principalType"),
		ResourceID:    parseInt64Default(c.QueryParam("resourceId"), 0),
		PrincipalID:   parseInt64Default(c.QueryParam("principalId"), 0),
	}
	shares, err := h.svc.ListContentShares(c.Request().Context(), filter)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, shares)
}

func (h *AccessHandler) ListShareableResources(c echo.Context) error {
	filter := repository.ShareableResourceFilter{
		ResourceType: c.QueryParam("resourceType"),
		Search:       c.QueryParam("search"),
		Limit:        parseIntDefault(c.QueryParam("limit"), 20),
	}
	resources, err := h.svc.ListShareableResources(c.Request().Context(), filter)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, resources)
}

func (h *AccessHandler) CreateContentShare(c echo.Context) error {
	var req dto.CreateContentShareRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	share, err := h.svc.CreateContentShare(c.Request().Context(), req, actorID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.recordAccessActivity(c, "content.share_upsert", "维护内容共享授权", fmt.Sprintf("%s #%d -> %s #%d", req.ResourceType, req.ResourceID, req.PrincipalType, req.PrincipalID))
	return response.OK(c, share)
}

func (h *AccessHandler) BatchCreateContentShares(c echo.Context) error {
	var req dto.BatchCreateContentSharesRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	result, err := h.svc.BatchCreateContentShares(c.Request().Context(), req, actorID(c))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	h.recordAccessActivity(
		c,
		"content.share_batch_upsert",
		"批量维护内容共享授权",
		fmt.Sprintf("%s %d 项 -> %s #%d", req.ResourceType, result.Total, req.PrincipalType, req.PrincipalID),
	)
	return response.OK(c, result)
}

func (h *AccessHandler) DeleteContentShare(c echo.Context) error {
	id, err := parseIDParam(c, "id", "无效的共享ID")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteContentShare(c.Request().Context(), id); err != nil {
		return response.Error(c, err)
	}
	h.recordAccessActivity(c, "content.share_delete", fmt.Sprintf("删除共享授权 #%d", id), "内容共享授权已删除")
	return response.OKEmpty(c)
}

func actorID(c echo.Context) *int64 {
	if lu := middleware.GetLoginUser(c); lu != nil {
		return &lu.UserID
	}
	return nil
}

func parseIDParam(c echo.Context, name string, message string) (int64, error) {
	id, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil || id <= 0 {
		return 0, response.FailWith(c, response.BadRequest, message)
	}
	return id, nil
}

func parseInt64Default(s string, def int64) int64 {
	if s == "" {
		return def
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return def
	}
	return n
}

func (h *AccessHandler) recordAccessActivity(c echo.Context, eventType, title, description string) {
	if h.activitySvc == nil {
		return
	}
	evtCat := "user"
	if eventType == "team.create" || eventType == "team.update" || eventType == "team.member_upsert" || eventType == "team.member_remove" {
		evtCat = "system"
	}
	if eventType == "content.share_upsert" || eventType == "content.share_delete" {
		evtCat = "post"
	}
	evtStatus := "SUCCESS"
	var userID *int64
	if lu := middleware.GetLoginUser(c); lu != nil {
		userID = &lu.UserID
	}
	if err := h.activitySvc.Create(c.Request().Context(), &model.ActivityEvent{
		EventType:     eventType,
		EventCategory: &evtCat,
		Title:         title,
		Description:   &description,
		UserID:        userID,
		Status:        &evtStatus,
	}); err != nil {
		log.Warn().Err(err).Str("event_type", eventType).Msg("record access activity failed")
	}
}
