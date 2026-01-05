import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	type AbsolutePath,
	buildClaudePluginDeclaration,
	type CoreError,
	coerceAbsolutePath,
	coerceAbsolutePathDirect,
	coerceGithubRef,
	coerceNonEmpty,
	type ExtractedSkill,
	extractSkillsFromPlugin,
	extractSkillsFromSingle,
	extractSkillsFromSubdir,
	type GithubRef,
	IGNORED_DIRS,
	MANIFEST_FILENAME,
	type ManifestInfo,
	type MarketplaceInfo,
	type MarketplacePluginMetadata,
	PLUGIN_SKILLS_DIR,
	parseMarketplace,
	type Result,
	resolveAutoDiscoverSkills,
	resolvePluginSource,
	type SkillEntry,
	type SkillExtractionWarning,
	type SkillInfo,
	type ValidatedDeclaration,
	validateManifest,
} from "@skills-supply/core"
import { cloneRemoteRepo } from "@/sources/git"
import type { IndexedDeclaration, IndexedMetadata, IndexedSkill } from "@/types"
import type { DiscoveryError, IoError } from "@/types/errors"

export interface ScanUnit {
	kind: "marketplace" | "manifest" | "single" | "subdir"
	path: string | null
	metadata: IndexedMetadata
	declaration: IndexedDeclaration
	skills: IndexedSkill[]
}

export type ScanWarning = DiscoveryError & { path: string }

export type ScanResult = Result<
	{ units: ScanUnit[]; warnings: ScanWarning[] },
	DiscoveryError
>

type ReadDirResult = Result<Dirent[], IoError>

type PluginSource = Extract<ValidatedDeclaration, { type: "github" | "git" | "local" }>

type ScanOptions = {
	pluginTempRoot?: string
}

export async function scanRepo(
	repoPath: string,
	githubRepo: string,
	options: ScanOptions = {},
): Promise<ScanResult> {
	const rootPath = coerceAbsolutePathDirect(repoPath)
	if (!rootPath) {
		return {
			error: {
				field: "path",
				message: `Repo path is not absolute: ${repoPath}`,
				path: repoPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const rootStat = await safeStat(rootPath)
	if (!rootStat.ok) {
		return rootStat
	}

	if (!rootStat.value?.isDirectory()) {
		return {
			error: {
				field: "path",
				message: `Repo path is not a directory: ${repoPath}`,
				path: repoPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const repoRef = coerceGithubRef(githubRepo)
	if (!repoRef) {
		return {
			error: {
				field: "githubRepo",
				message: `Invalid GitHub repo: ${githubRepo}`,
				path: repoPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const providedPluginRoot = options.pluginTempRoot
		? coerceAbsolutePathDirect(options.pluginTempRoot)
		: null
	if (options.pluginTempRoot && !providedPluginRoot) {
		return {
			error: {
				field: "pluginTempRoot",
				message: `Plugin temp root is not absolute: ${options.pluginTempRoot}`,
				path: options.pluginTempRoot,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	let pluginTempRoot: AbsolutePath | null = providedPluginRoot
	let ownsPluginTempRoot = false
	const pluginCache = new Map<string, AbsolutePath>()

	const ensurePluginTempRoot = async (): Promise<
		Result<AbsolutePath, DiscoveryError>
	> => {
		if (pluginTempRoot) {
			try {
				await mkdir(pluginTempRoot, { recursive: true })
			} catch (error) {
				return {
					error: {
						message: `Unable to create plugin temp root: ${pluginTempRoot}`,
						operation: "mkdir",
						path: pluginTempRoot,
						rawError: error instanceof Error ? error : undefined,
						type: "io",
					},
					ok: false,
				}
			}
			return { ok: true, value: pluginTempRoot }
		}

		let created: string
		try {
			created = await mkdtemp(path.join(tmpdir(), "sk-discovery-plugins-"))
		} catch (error) {
			return {
				error: {
					message: "Unable to create plugin temp directory.",
					operation: "mkdtemp",
					path: tmpdir(),
					rawError: error instanceof Error ? error : undefined,
					type: "io",
				},
				ok: false,
			}
		}

		const resolved = coerceAbsolutePathDirect(created)
		if (!resolved) {
			return {
				error: {
					field: "pluginTempRoot",
					message: `Plugin temp root is not absolute: ${created}`,
					path: created,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		pluginTempRoot = resolved
		ownsPluginTempRoot = true
		return { ok: true, value: resolved }
	}

	const warnings: ScanWarning[] = []
	const units: ScanUnit[] = []
	const rootMarketplacePath = coerceAbsolutePathDirect(
		path.join(rootPath, ".claude-plugin", "marketplace.json"),
	)
	if (!rootMarketplacePath) {
		return {
			error: {
				field: "path",
				message: `Unable to resolve marketplace.json under ${rootPath}.`,
				path: rootPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	const marketplaceStat = await safeStat(rootMarketplacePath)
	if (!marketplaceStat.ok) {
		return marketplaceStat
	}
	if (marketplaceStat.value && !marketplaceStat.value.isFile()) {
		warnings.push({
			field: "marketplace",
			message: `Expected file at ${rootMarketplacePath}.`,
			path: rootMarketplacePath,
			source: "manual",
			type: "validation",
		})
	}
	try {
		if (marketplaceStat.value?.isFile()) {
			const marketplaceUnits = await buildMarketplaceUnits({
				ensurePluginTempRoot,
				marketplacePath: rootMarketplacePath,
				marketplaceRef: repoRef,
				pluginCache,
				repoRoot: rootPath,
				warnings,
			})
			units.push(...marketplaceUnits)
		}

		const rootManifestPath = coerceAbsolutePathDirect(
			path.join(rootPath, MANIFEST_FILENAME),
		)
		if (!rootManifestPath) {
			return {
				error: {
					field: "path",
					message: `Unable to resolve ${MANIFEST_FILENAME} under ${rootPath}.`,
					path: rootPath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const manifestStat = await safeStat(rootManifestPath)
		if (!manifestStat.ok) {
			return manifestStat
		}
		if (manifestStat.value && !manifestStat.value.isFile()) {
			warnings.push({
				field: "manifest",
				message: `Expected file at ${rootManifestPath}.`,
				path: rootManifestPath,
				source: "manual",
				type: "validation",
			})
		}
		if (manifestStat.value?.isFile()) {
			const manifestUnit = await buildManifestUnit({
				githubRepo: repoRef,
				manifestPath: rootManifestPath,
				packagePath: rootPath,
				repoRoot: rootPath,
				warnings,
			})
			if (manifestUnit) {
				units.push(manifestUnit)
			}
		}

		if (units.length > 0) {
			return { ok: true, value: { units, warnings } }
		}

		const stack: AbsolutePath[] = [rootPath]

		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) {
				continue
			}

			const subdirUnit = await buildSubdirUnit({
				githubRepo: repoRef,
				repoRoot: rootPath,
				rootDir: current,
				warnings,
			})
			if (subdirUnit) {
				units.push(subdirUnit)
				continue
			}

			const singleUnit = await buildSingleSkillUnit({
				githubRepo: repoRef,
				repoRoot: rootPath,
				skillDir: current,
				warnings,
			})
			if (singleUnit) {
				units.push(singleUnit)
				continue
			}

			const entriesResult = await readDirEntries(current, current)
			if (!entriesResult.ok) {
				return entriesResult
			}

			for (const entry of entriesResult.value) {
				if (!entry.isDirectory()) {
					continue
				}

				if (IGNORED_DIRS.has(entry.name)) {
					continue
				}

				const childPath = coerceAbsolutePathDirect(path.join(current, entry.name))
				if (!childPath) {
					return {
						error: {
							field: "path",
							message: `Unable to resolve ${entry.name} under ${current}.`,
							path: current,
							source: "manual",
							type: "validation",
						},
						ok: false,
					}
				}

				stack.push(childPath)
			}
		}
	} finally {
		if (ownsPluginTempRoot && pluginTempRoot) {
			await rm(pluginTempRoot, { force: true, recursive: true })
		}
	}

	return { ok: true, value: { units, warnings } }
}

async function buildMarketplaceUnits(options: {
	marketplacePath: AbsolutePath
	marketplaceRef: GithubRef
	repoRoot: AbsolutePath
	warnings: ScanWarning[]
	pluginCache: Map<string, AbsolutePath>
	ensurePluginTempRoot: () => Promise<Result<AbsolutePath, DiscoveryError>>
}): Promise<ScanUnit[]> {
	const contents = await readFileText(options.marketplacePath, options.warnings)
	if (!contents) {
		return []
	}

	const parsed = parseMarketplace(contents)
	if (!parsed.ok) {
		options.warnings.push({
			...parsed.error,
			path: options.marketplacePath,
		})
		return []
	}

	const units: ScanUnit[] = []
	for (const plugin of parsed.value.plugins) {
		const resolved = resolvePluginSource(parsed.value, plugin.name, options.repoRoot)
		if (!resolved.ok) {
			options.warnings.push(
				withWarningPath(resolved.error, options.marketplacePath),
			)
			continue
		}
		if (!isPluginSource(resolved.value)) {
			options.warnings.push({
				field: "source",
				message: `Unsupported plugin source for "${plugin.name}".`,
				path: options.marketplacePath,
				source: "manual",
				type: "validation",
			})
			continue
		}

		const rootResult = await resolvePluginRoot({
			cache: options.pluginCache,
			ensurePluginTempRoot: options.ensurePluginTempRoot,
			source: resolved.value,
		})
		if (!rootResult.ok) {
			options.warnings.push(
				withWarningPath(rootResult.error, options.marketplacePath),
			)
			continue
		}

		const pluginRoot = rootResult.value
		const skillsDir = coerceAbsolutePathDirect(
			path.join(pluginRoot, PLUGIN_SKILLS_DIR),
		)
		if (!skillsDir) {
			options.warnings.push({
				field: "skills",
				message: `Plugin skills directory is not absolute: ${pluginRoot}`,
				path: pluginRoot,
				source: "manual",
				type: "validation",
			})
			continue
		}

		const extracted = await extractSkillsFromPlugin({
			mode: "lenient",
			packageRoot: pluginRoot,
			skillsDir,
		})
		if (!extracted.ok) {
			options.warnings.push(withWarningPath(extracted.error, skillsDir))
			continue
		}

		pushWarnings(options.warnings, extracted.value.warnings)

		if (extracted.value.skills.length === 0) {
			options.warnings.push({
				field: "skills",
				message: `No valid skills found for plugin "${plugin.name}".`,
				path: skillsDir,
				source: "manual",
				type: "validation",
			})
			continue
		}

		units.push({
			declaration: buildClaudePluginDeclaration(
				options.marketplaceRef,
				plugin.name,
			),
			kind: "marketplace",
			metadata: toMarketplaceMetadata(plugin),
			path: null,
			skills: toSkillEntries(extracted.value.skills),
		})
	}

	return units
}

async function buildManifestUnit(options: {
	githubRepo: GithubRef
	manifestPath: AbsolutePath
	packagePath: AbsolutePath
	repoRoot: AbsolutePath
	warnings: ScanWarning[]
}): Promise<ScanUnit | null> {
	const contents = await readFileText(options.manifestPath, options.warnings)
	if (!contents) {
		return null
	}

	const adapted = validateManifest(contents, options.manifestPath)
	if (!adapted.ok) {
		options.warnings.push({
			...adapted.error,
			path: options.manifestPath,
		})
		return null
	}

	if (!adapted.value.package) {
		return null
	}

	const skillsSetting = resolveAutoDiscoverSkills(adapted.value.exports)
	if (skillsSetting === false) {
		options.warnings.push({
			field: "exports.auto_discover.skills",
			message: "Skill auto-discovery is disabled in agents.toml.",
			path: options.manifestPath,
			source: "manual",
			type: "validation",
		})
		return null
	}

	const skillsRoot = coerceAbsolutePath(
		skillsSetting,
		path.dirname(options.manifestPath),
	)
	if (!skillsRoot) {
		options.warnings.push({
			field: "exports.auto_discover.skills",
			message: `Invalid skills path "${skillsSetting}" in ${options.manifestPath}.`,
			path: options.manifestPath,
			source: "manual",
			type: "validation",
		})
		return null
	}

	const extracted = await extractSkillsFromSubdir({
		mode: "lenient",
		packageRoot: options.packagePath,
		rootDir: skillsRoot,
	})
	if (!extracted.ok) {
		options.warnings.push(withWarningPath(extracted.error, skillsRoot))
		return null
	}

	pushWarnings(options.warnings, extracted.value.warnings)

	if (extracted.value.skills.length === 0) {
		options.warnings.push({
			field: "skills",
			message: `No valid skills found in ${skillsRoot}.`,
			path: skillsRoot,
			source: "manual",
			type: "validation",
		})
		return null
	}

	const relativePath = toOptionalRepoPath(options.repoRoot, options.packagePath)
	const pathValue = relativePath
		? (coerceNonEmpty(relativePath) ?? undefined)
		: undefined
	const declaration: ValidatedDeclaration = pathValue
		? { gh: options.githubRepo, path: pathValue, type: "github" }
		: { gh: options.githubRepo, type: "github" }

	return {
		declaration,
		kind: "manifest",
		metadata: toManifestMetadata(adapted.value),
		path: relativePath,
		skills: toSkillEntries(extracted.value.skills),
	}
}

async function buildSingleSkillUnit(options: {
	githubRepo: GithubRef
	repoRoot: AbsolutePath
	skillDir: AbsolutePath
	warnings: ScanWarning[]
}): Promise<ScanUnit | null> {
	const extracted = await extractSkillsFromSingle({
		mode: "lenient",
		packageRoot: options.skillDir,
		skillDir: options.skillDir,
	})
	if (!extracted.ok) {
		options.warnings.push(withWarningPath(extracted.error, options.skillDir))
		return null
	}

	pushWarnings(options.warnings, extracted.value.warnings)

	if (extracted.value.skills.length === 0) {
		options.warnings.push({
			field: "skills",
			message: `No valid skills found in ${options.skillDir}.`,
			path: options.skillDir,
			source: "manual",
			type: "validation",
		})
		return null
	}

	const skillMetadata = extracted.value.skills[0]
	const relative = toOptionalRepoPath(options.repoRoot, options.skillDir)
	const pathValue = relative ? (coerceNonEmpty(relative) ?? undefined) : undefined
	const declaration: ValidatedDeclaration = pathValue
		? { gh: options.githubRepo, path: pathValue, type: "github" }
		: { gh: options.githubRepo, type: "github" }

	return {
		declaration,
		kind: "single",
		metadata: {
			description: skillMetadata.description,
			name: skillMetadata.name,
		},
		path: relative,
		skills: toSkillEntries(extracted.value.skills),
	}
}

async function buildSubdirUnit(options: {
	githubRepo: GithubRef
	repoRoot: AbsolutePath
	rootDir: AbsolutePath
	warnings: ScanWarning[]
}): Promise<ScanUnit | null> {
	const extracted = await extractSkillsFromSubdir({
		mode: "lenient",
		packageRoot: options.rootDir,
		rootDir: options.rootDir,
	})
	if (!extracted.ok) {
		options.warnings.push(withWarningPath(extracted.error, options.rootDir))
		return null
	}

	pushWarnings(options.warnings, extracted.value.warnings)

	if (extracted.value.skills.length === 0) {
		options.warnings.push({
			field: "skills",
			message: `No valid skills found in ${options.rootDir}.`,
			path: options.rootDir,
			source: "manual",
			type: "validation",
		})
		return null
	}

	const metadata = aggregateSubdirMetadata(options.rootDir)
	const relative = toOptionalRepoPath(options.repoRoot, options.rootDir)
	const pathValue = relative ? (coerceNonEmpty(relative) ?? undefined) : undefined
	const declaration: ValidatedDeclaration = pathValue
		? { gh: options.githubRepo, path: pathValue, type: "github" }
		: { gh: options.githubRepo, type: "github" }

	return {
		declaration,
		kind: "subdir",
		metadata,
		path: relative,
		skills: toSkillEntries(extracted.value.skills),
	}
}

function aggregateSubdirMetadata(rootDir: AbsolutePath): SkillInfo {
	const dirName = path.basename(rootDir)
	const name = coerceNonEmpty(dirName) ?? (dirName as SkillInfo["name"])
	return { name }
}

function toSkillEntries(skills: ExtractedSkill[]): SkillEntry[] {
	return skills.map((skill) => ({
		description: skill.description,
		name: skill.name,
		relativePath: skill.relativePath,
	}))
}

function pushWarnings(
	target: ScanWarning[],
	warnings: readonly SkillExtractionWarning[],
): void {
	for (const warning of warnings) {
		target.push(warning as ScanWarning)
	}
}

function withWarningPath(
	error: DiscoveryError | CoreError,
	fallbackPath: AbsolutePath,
): ScanWarning {
	if ("path" in error && typeof error.path === "string") {
		return error as ScanWarning
	}
	return { ...error, path: fallbackPath } as ScanWarning
}

async function resolvePluginRoot(options: {
	source: PluginSource
	cache: Map<string, AbsolutePath>
	ensurePluginTempRoot: () => Promise<Result<AbsolutePath, DiscoveryError>>
}): Promise<Result<AbsolutePath, DiscoveryError>> {
	const cacheKey = pluginSourceKey(options.source)
	const cached = options.cache.get(cacheKey)
	if (cached) {
		return { ok: true, value: cached }
	}

	if (options.source.type === "local") {
		const stats = await safeStat(options.source.path)
		if (!stats.ok) {
			return stats
		}
		if (!stats.value) {
			return {
				error: {
					message: `Plugin source not found: ${options.source.path}`,
					path: options.source.path,
					target: "plugin",
					type: "not_found",
				},
				ok: false,
			}
		}
		if (!stats.value.isDirectory()) {
			return {
				error: {
					field: "source",
					message: `Plugin source is not a directory: ${options.source.path}`,
					path: options.source.path,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		options.cache.set(cacheKey, options.source.path)
		return { ok: true, value: options.source.path }
	}

	const tempRootResult = await options.ensurePluginTempRoot()
	if (!tempRootResult.ok) {
		return tempRootResult
	}

	const cloneDirResult = buildCloneDir(tempRootResult.value, cacheKey)
	if (!cloneDirResult.ok) {
		return cloneDirResult
	}

	const remoteUrl =
		options.source.type === "github"
			? `https://github.com/${options.source.gh}.git`
			: options.source.url

	const cloneResult = await cloneRemoteRepo({
		destination: cloneDirResult.value,
		remoteUrl,
	})
	if (!cloneResult.ok) {
		return cloneResult
	}

	const resolved = coerceAbsolutePathDirect(cloneResult.value.repoPath)
	if (!resolved) {
		return {
			error: {
				field: "path",
				message: `Plugin repo path is not absolute: ${cloneResult.value.repoPath}`,
				path: cloneResult.value.repoPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	options.cache.set(cacheKey, resolved)
	return { ok: true, value: resolved }
}

function pluginSourceKey(source: PluginSource): string {
	if (source.type === "github") {
		return `github:${source.gh}`
	}
	if (source.type === "git") {
		return `git:${source.url}`
	}
	return `local:${source.path}`
}

function isPluginSource(declaration: ValidatedDeclaration): declaration is PluginSource {
	return (
		declaration.type === "github" ||
		declaration.type === "git" ||
		declaration.type === "local"
	)
}

function buildCloneDir(
	root: AbsolutePath,
	key: string,
): Result<AbsolutePath, DiscoveryError> {
	const digest = createHash("sha1").update(key).digest("hex")
	const destination = coerceAbsolutePathDirect(path.join(root, digest))
	if (!destination) {
		return {
			error: {
				field: "path",
				message: `Clone destination is not absolute: ${root}`,
				path: root,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	return { ok: true, value: destination }
}

function toMarketplaceMetadata(
	plugin: MarketplaceInfo["plugins"][number],
): MarketplacePluginMetadata {
	const { source: _source, ...rest } = plugin
	return rest
}

function toManifestMetadata(manifest: ManifestInfo): IndexedMetadata {
	if (!manifest.package) {
		return null
	}
	const { name, version, description, license, org } = manifest.package
	return { description, license, name, org, version }
}

async function readFileText(
	filePath: string,
	warnings: ScanWarning[],
): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8")
	} catch (error) {
		warnings.push({
			message: `Unable to read ${filePath}.`,
			operation: "readFile",
			path: filePath,
			rawError: error instanceof Error ? error : undefined,
			type: "io",
		})
		return null
	}
}

function toOptionalRepoPath(
	repoPath: AbsolutePath,
	targetPath: AbsolutePath,
): string | null {
	const relative = toRepoRelativePath(repoPath, targetPath)
	if (!relative || relative === ".") {
		return null
	}
	return relative
}

function toRepoRelativePath(repoPath: AbsolutePath, targetPath: AbsolutePath): string {
	const relative = path.relative(repoPath, targetPath)
	return relative.split(path.sep).join("/")
}

async function readDirEntries(
	rootPath: AbsolutePath,
	errorPath: AbsolutePath,
): Promise<ReadDirResult> {
	try {
		const entries = await readdir(rootPath, { withFileTypes: true })
		return { ok: true, value: entries }
	} catch (error) {
		return {
			error: {
				message: `Unable to read ${rootPath}.`,
				operation: "readdir",
				path: errorPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function safeStat(
	targetPath: string,
): Promise<Result<Awaited<ReturnType<typeof stat>> | null, IoError>> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return {
			error: {
				message: `Unable to access ${targetPath}.`,
				operation: "stat",
				path: targetPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}
