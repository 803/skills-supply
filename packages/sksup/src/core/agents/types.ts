export type AgentId = "claude-code" | "codex" | "opencode"

export interface AgentDefinition {
	id: AgentId
	displayName: string
	skillsPath: string
	detect: () => Promise<AgentDetectionResult>
}

export type AgentRegistryErrorType = "unknown_agent" | "io_error"

export interface AgentRegistryError {
	type: AgentRegistryErrorType
	message: string
	agentId?: string
	path?: string
}

export type AgentDetectionResult =
	| { ok: true; value: boolean }
	| { ok: false; error: AgentRegistryError }

export type AgentLookupResult =
	| { ok: true; value: AgentDefinition }
	| { ok: false; error: AgentRegistryError }

export type AgentListResult =
	| { ok: true; value: AgentDefinition[] }
	| { ok: false; error: AgentRegistryError }
