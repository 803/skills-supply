/**
 * @skills-supply/core
 *
 * Shared constants, types, and pure utilities for package detection and parsing.
 */

export {
	IGNORED_DIRS,
	MANIFEST_FILENAME,
	MARKETPLACE_FILENAME,
	PLUGIN_DIR,
	PLUGIN_FILENAME,
	PLUGIN_SKILLS_DIR,
	SK_GLOBAL_DIR,
	SKILL_FILENAME,
} from "@/constants"
export { detectStructure } from "@/detection/structure"
export {
	discoverSkillPathsForPlugin,
	discoverSkillPathsForSubdir,
} from "@/discovery/paths"
export { validateManifest } from "@/manifest/validate"
export { buildClaudePluginDeclaration } from "@/marketplace/build"
export { resolvePluginSource } from "@/marketplace/resolve"
export { parseFrontmatter } from "@/parsing/frontmatter"
export { parseMarketplace } from "@/parsing/marketplace"
export { parsePlugin } from "@/parsing/plugin"
export type {
	AbsolutePath,
	AgentId,
	Alias,
	GithubRef,
	GitUrl,
	NonEmptyString,
	RemoteMarketplaceUrl,
} from "@/types/branded"
export { unwrap } from "@/types/branded"
export {
	coerceAbsolutePath,
	coerceAbsolutePathDirect,
	coerceAgentId,
	coerceAlias,
	coerceGithubRef,
	coerceGitRef,
	coerceGitUrl,
	coerceNonEmpty,
	coerceRemoteMarketplaceUrl,
	VALID_AGENT_IDS,
} from "@/types/coerce"
export type {
	ManifestInfo,
	ManifestPackageMetadata,
	MarketplaceInfo,
	MarketplacePlugin,
	MarketplacePluginMetadata,
	PluginInfo,
	SkillInfo,
} from "@/types/content"
export type {
	GitRef,
	RawDeclaration,
	ValidatedDeclaration,
} from "@/types/declaration"
export type { DetectedStructure, DetectionTarget } from "@/types/detection"
export type { BaseError, CoreError, Result } from "@/types/error"
export {
	isAbsolutePath,
	isAgentId,
	isAlias,
	isGithubRef,
	isGitUrl,
	isNonEmpty,
	isRemoteMarketplaceUrl,
} from "@/types/guards"
export { validateDeclaration } from "@/validation/declaration"
