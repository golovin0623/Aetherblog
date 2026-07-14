package dto

// AgentKnowledgeContextMode is the trusted execution contract for one Agent
// turn. It is normalized by the Go proxy before any permission-based source
// injection and forwarded unchanged to the AI service.
type AgentKnowledgeContextMode string

const (
	AgentKnowledgeContextModeAuto     AgentKnowledgeContextMode = "auto"
	AgentKnowledgeContextModeSelected AgentKnowledgeContextMode = "selected"
	AgentKnowledgeContextModeNone     AgentKnowledgeContextMode = "none"
)

func (mode AgentKnowledgeContextMode) Valid() bool {
	switch mode {
	case AgentKnowledgeContextModeAuto,
		AgentKnowledgeContextModeSelected,
		AgentKnowledgeContextModeNone:
		return true
	default:
		return false
	}
}
