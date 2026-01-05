import type { AbsolutePath, AgentId, Alias, NonEmptyString } from "@/types/branded"
import type { ValidatedDeclaration } from "@/types/declaration"

export type MarketplaceSource =
	| string
	| number
	| boolean
	| null
	| Record<string, unknown>
	| unknown[]

export type MarketplacePlugin = {
	name: NonEmptyString
	source: MarketplaceSource
	description?: NonEmptyString
	version?: NonEmptyString
	author?: { name?: NonEmptyString; email?: NonEmptyString }
	keywords?: NonEmptyString[]
	homepage?: NonEmptyString
	repository?: NonEmptyString
	license?: NonEmptyString
	category?: NonEmptyString
}

export type MarketplaceInfo = {
	name: NonEmptyString
	owner?: { name: NonEmptyString; email?: NonEmptyString }
	plugins: MarketplacePlugin[]
	metadata?: {
		pluginRoot?: NonEmptyString
		description?: NonEmptyString
		version?: NonEmptyString
	}
}

export type PluginInfo = {
	name: NonEmptyString
	description?: NonEmptyString
	version?: NonEmptyString
}

export type ManifestInfo = {
	package?: {
		name: NonEmptyString
		version: NonEmptyString
		description?: NonEmptyString
		license?: NonEmptyString
		org?: NonEmptyString
	}
	agents: Map<AgentId, boolean>
	dependencies: Map<Alias, ValidatedDeclaration>
	exports?: {
		auto_discover?: { skills: NonEmptyString | false }
	}
}

export type ManifestPackageMetadata = NonNullable<ManifestInfo["package"]>

export type SkillInfo = {
	name: NonEmptyString
	description?: NonEmptyString
}

export type SkillEntry = SkillInfo & {
	relativePath: NonEmptyString
}

export type ExtractedSkill = SkillEntry & {
	sourcePath: AbsolutePath
}

export type MarketplacePluginMetadata = {
	name: NonEmptyString
	description?: NonEmptyString
	version?: NonEmptyString
	author?: { name?: NonEmptyString; email?: NonEmptyString }
	keywords?: NonEmptyString[]
	homepage?: NonEmptyString
	repository?: NonEmptyString
	license?: NonEmptyString
	category?: NonEmptyString
}
