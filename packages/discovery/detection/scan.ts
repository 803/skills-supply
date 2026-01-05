import type { Dirent } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import {
	type AbsolutePath,
	buildClaudePluginDeclaration,
	coerceAbsolutePathDirect,
	coerceGithubRef,
	coerceNonEmpty,
	discoverSkillPathsForSubdir,
	type GithubRef,
	IGNORED_DIRS,
	MANIFEST_FILENAME,
	type ManifestInfo,
	type MarketplaceInfo,
	type MarketplacePlugin,
	type MarketplacePluginMetadata,
	parseFrontmatter,
	parseMarketplace,
	type Result,
	SKILL_FILENAME,
	type SkillInfo,
	type ValidatedDeclaration,
	validateManifest,
} from "@skills-supply/core"
import type { IndexedDeclaration, IndexedMetadata } from "@/types"
import type { DiscoveryError, IoError } from "@/types/errors"

export interface ScanUnit {
	kind: "marketplace" | "manifest" | "single" | "subdir"
	path: string | null
	metadata: IndexedMetadata
	declaration: IndexedDeclaration
}

export type ScanWarning = DiscoveryError & { path: string }

export type ScanResult = Result<
	{ units: ScanUnit[]; warnings: ScanWarning[] },
	DiscoveryError
>

type ReadDirResult = Result<Dirent[], IoError>

export async function scanRepo(
	repoPath: string,
	githubRepo: string,
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
	if (marketplaceStat.value?.isFile()) {
		const marketplaceUnits = await buildMarketplaceUnits({
			marketplacePath: rootMarketplacePath,
			marketplaceRef: repoRef,
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

	return { ok: true, value: { units, warnings } }
}

async function buildMarketplaceUnits(options: {
	marketplacePath: AbsolutePath
	marketplaceRef: GithubRef
	warnings: ScanWarning[]
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

	return parsed.value.plugins.map((plugin: MarketplacePlugin) => ({
		declaration: buildClaudePluginDeclaration(options.marketplaceRef, plugin.name),
		kind: "marketplace",
		metadata: toMarketplaceMetadata(plugin),
		path: null,
	}))
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
	}
}

async function buildSingleSkillUnit(options: {
	githubRepo: GithubRef
	repoRoot: AbsolutePath
	skillDir: AbsolutePath
	warnings: ScanWarning[]
}): Promise<ScanUnit | null> {
	const skillInfo = await loadSkillInfo(options.skillDir, options.warnings)
	if (!skillInfo) {
		return null
	}

	const relative = toOptionalRepoPath(options.repoRoot, options.skillDir)
	const pathValue = relative ? (coerceNonEmpty(relative) ?? undefined) : undefined
	const declaration: ValidatedDeclaration = pathValue
		? { gh: options.githubRepo, path: pathValue, type: "github" }
		: { gh: options.githubRepo, type: "github" }

	return {
		declaration,
		kind: "single",
		metadata: skillInfo,
		path: relative,
	}
}

async function buildSubdirUnit(options: {
	githubRepo: GithubRef
	repoRoot: AbsolutePath
	rootDir: AbsolutePath
	warnings: ScanWarning[]
}): Promise<ScanUnit | null> {
	const skillDirs = await discoverSkillPathsForSubdir(options.rootDir)
	if (!skillDirs.ok) {
		options.warnings.push({
			...skillDirs.error,
			path: skillDirs.error.path ?? options.rootDir,
		})
		return null
	}

	if (skillDirs.value.length === 0) {
		return null
	}

	let hasValidSkill = false
	for (const skillDir of skillDirs.value) {
		const skillInfo = await loadSkillInfo(skillDir, options.warnings)
		if (skillInfo) {
			hasValidSkill = true
		}
	}

	if (!hasValidSkill) {
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
	}
}

async function loadSkillInfo(
	skillDir: AbsolutePath,
	warnings: ScanWarning[],
): Promise<SkillInfo | null> {
	const skillFile = path.join(skillDir, SKILL_FILENAME)
	const stats = await safeStat(skillFile)
	if (!stats.ok) {
		warnings.push({
			...stats.error,
			path: stats.error.path,
		})
		return null
	}

	if (!stats.value) {
		return null
	}

	if (!stats.value.isFile()) {
		warnings.push({
			field: "skill",
			message: `Expected file at ${skillFile}.`,
			path: skillFile,
			source: "manual",
			type: "validation",
		})
		return null
	}

	const contents = await readFileText(skillFile, warnings)
	if (!contents) {
		return null
	}

	const parsed = parseFrontmatter(contents)
	if (!parsed.ok) {
		warnings.push({
			...parsed.error,
			path: skillFile,
		})
		return null
	}

	return parsed.value
}

function aggregateSubdirMetadata(rootDir: AbsolutePath): SkillInfo {
	const dirName = path.basename(rootDir)
	const name = coerceNonEmpty(dirName) ?? (dirName as SkillInfo["name"])
	return { name }
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
