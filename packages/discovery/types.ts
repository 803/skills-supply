import type {
	ManifestPackageMetadata,
	MarketplacePluginMetadata,
	SkillEntry,
	SkillInfo,
	ValidatedDeclaration,
} from "@skills-supply/core"

export type IndexedDeclaration = ValidatedDeclaration

export type IndexedMetadata =
	| SkillInfo
	| MarketplacePluginMetadata
	| ManifestPackageMetadata
	| null

export type IndexedSkill = SkillEntry
