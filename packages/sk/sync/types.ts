import type { Result } from "@skills-supply/core"
import type { ResolvedAgent } from "@/agents/types"
import type { Manifest } from "@/manifest/types"
import type { CanonicalPackage, Skill } from "@/packages/types"
import type { SkError } from "@/types/errors"

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

export type SyncError = SkError & { stage: SyncStage }

export type SyncResult<T> = Result<T, SyncError>

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
	noOpReason?: "no-dependencies"
	warnings: string[]
}

export interface SyncOptions {
	dryRun: boolean
	agents: ResolvedAgent[]
	manifest: Manifest
}
