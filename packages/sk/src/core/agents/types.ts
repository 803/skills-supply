import type { CanonicalPackage, Skill } from "@/src/core/packages/types"

export type AgentId = "claude-code" | "codex" | "opencode"

export interface AgentDefinition {
	id: AgentId
	displayName: string
	basePath: string
	skillsDir: string
	detect: () => Promise<AgentDetectionResult>
}

export interface ResolvedAgent {
	id: AgentId
	displayName: string
	rootPath: string
	skillsPath: string
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

export interface InstallablePackage {
	canonical: CanonicalPackage
	prefix: string
	skills: Skill[]
}

export interface InstalledSkill {
	agentId: AgentId
	name: string
	sourcePath: string
	targetPath: string
}

export type AgentInstallErrorType =
	| "invalid_input"
	| "invalid_target"
	| "conflict"
	| "io_error"

export interface AgentInstallError {
	type: AgentInstallErrorType
	message: string
	agentId: AgentId
	path?: string
}

export type AgentInstallResult =
	| { ok: true; value: InstalledSkill[] }
	| { ok: false; error: AgentInstallError }
