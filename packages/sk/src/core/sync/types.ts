import type { AgentDefinition } from "@/src/core/agents/types"
import type { Manifest, MergedManifest } from "@/src/core/manifest/types"
import type { CanonicalPackage, Skill } from "@/src/core/packages/types"

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
	dependencies: CanonicalPackage[]
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
	dependencies: number
	removed: number
	warnings: string[]
}

export interface SyncOptions {
	dryRun: boolean
}
