import type { AbsolutePath, AgentId } from "@skills-supply/core"
import type { CanonicalPackage, Skill } from "@/packages/types"
import type {
	ConflictError,
	IoError,
	NotFoundError,
	ValidationError,
} from "@/types/errors"

export type { AgentId }

export interface AgentDefinition {
	id: AgentId
	displayName: string
	localBasePath: string
	globalBasePath: string
	skillsDir: string
	detect: () => Promise<AgentDetectionResult>
}

export interface ResolvedAgent {
	id: AgentId
	displayName: string
	rootPath: AbsolutePath
	skillsPath: AbsolutePath
}

export type AgentRegistryError =
	| (NotFoundError & { target: "agent"; agentId: string })
	| (IoError & { agentId?: string })

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
	sourcePath: AbsolutePath
	targetPath: AbsolutePath
}

export type AgentInstallError =
	| (ValidationError & { agentId: AgentId })
	| (ConflictError & { agentId: AgentId })
	| (IoError & { agentId: AgentId })

export type AgentInstallResult =
	| { ok: true; value: InstalledSkill[] }
	| { ok: false; error: AgentInstallError }
