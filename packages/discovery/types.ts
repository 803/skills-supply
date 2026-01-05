import type {
	ManifestPackageMetadata,
	MarketplacePluginMetadata,
	SkillInfo,
	ValidatedDeclaration,
} from "@skills-supply/core"

export type IndexedDeclaration = ValidatedDeclaration

export type IndexedMetadata =
	| SkillInfo
	| MarketplacePluginMetadata
	| ManifestPackageMetadata
	| null
