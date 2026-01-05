import type {
	AbsolutePath,
	AgentId,
	Alias,
	CoreError,
	ManifestInfo,
	RawDeclaration,
	Result,
	ValidatedDeclaration,
} from "@skills-supply/core"
import type { ManifestOrigin } from "@/types/context"
import type { IoError, ValidationError } from "@/types/errors"

export type DependencyDeclaration = RawDeclaration

export interface DependencyDraft {
	alias: string
	declaration: DependencyDeclaration
}

export type Manifest = ManifestInfo & {
	origin: ManifestOrigin
}

export type ManifestParseResult = Result<Manifest, CoreError>

export type ManifestDiscoveryError =
	| (ValidationError & { path: AbsolutePath })
	| (IoError & { path: AbsolutePath })

export type ManifestDiscoveryResult =
	| { ok: true; value: AbsolutePath | null }
	| { ok: false; error: ManifestDiscoveryError }

export type ManifestAgentMap = ReadonlyMap<AgentId, boolean>
export type ManifestDependencyMap = ReadonlyMap<Alias, ValidatedDeclaration>
