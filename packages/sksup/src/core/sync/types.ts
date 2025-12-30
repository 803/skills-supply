import type { AgentDefinition } from "@/core/agents/types"
import type { Manifest, MergedManifest } from "@/core/manifest/types"
import type { CanonicalPackage, Skill } from "@/core/packages/types"

export type SyncStage =
	| "discover"
	| "parse"
	| "merge"
	| "resolve"
	| "agents"
	| "fetch"
	| "detect"
	| "extract"
	| "validate"
	| "install"
	| "reconcile"

export interface SyncError {
	stage: SyncStage
	message: string
	details?: unknown
}

export type SyncResult<T> = { ok: true; value: T } | { ok: false; error: SyncError }

export interface ResolvedManifest {
	manifests: Manifest[]
	merged: MergedManifest
	packages: CanonicalPackage[]
	agents: AgentDefinition[]
}

export interface ExtractedPackage {
	canonical: CanonicalPackage
	prefix: string
	skills: Skill[]
}

export interface SyncSummary {
	agents: string[]
	dryRun: boolean
	installed: number
	manifests: number
	packages: number
	removed: number
	warnings: string[]
}

export interface SyncOptions {
	dryRun: boolean
}
