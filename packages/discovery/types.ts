import type {
	ManifestPackageMetadata,
	MarketplacePluginMetadata,
	SkillEntry,
	ValidatedDeclaration,
} from "@skills-supply/core"

export type IndexedDeclaration = ValidatedDeclaration

export type IndexedMetadata = MarketplacePluginMetadata | ManifestPackageMetadata | null

export type IndexedSkill = SkillEntry
