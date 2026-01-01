import { execFile } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { ResolvedAgent } from "@/src/core/agents/types"
import { readTextFile, safeStat } from "@/src/core/io/fs"
import { coerceDependency } from "@/src/core/manifest/coerce"
import type { DependencyDeclaration } from "@/src/core/manifest/types"
import {
	type MarketplacePluginEntry,
	parseMarketplaceJson,
} from "@/src/core/marketplace/parse"
import {
	fetchGithubRepository,
	fetchGitRepository,
	parseGithubSlug,
} from "@/src/core/packages/fetch"
import { resolveValidatedDependency } from "@/src/core/packages/resolve"
import type {
	CanonicalPackage,
	ClaudePluginPackage,
	PackageOrigin,
} from "@/src/core/packages/types"
import { failSync } from "@/src/core/sync/errors"
import { buildRepoDir, buildRepoKey } from "@/src/core/sync/repo"
import type { SyncResult } from "@/src/core/sync/types"
import type { AbsolutePath, Alias } from "@/src/core/types/branded"
import {
	coerceAbsolutePath,
	coerceAbsolutePathDirect,
	coerceAlias,
} from "@/src/core/types/coerce"

// Create a fake origin for marketplace operations
function createMarketplaceOrigin(manifestPath: string): PackageOrigin {
	return {
		alias: coerceAlias("marketplace") ?? ("marketplace" as Alias),
		manifestPath:
			coerceAbsolutePathDirect(manifestPath) ?? (manifestPath as AbsolutePath),
	}
}

const execFileAsync = promisify(execFile)

interface MarketplaceInfo {
	manifestPath: string
	name: string
	plugins: MarketplacePluginEntry[]
	pluginRootPath?: string
	rootPath: string
	source: MarketplaceSource
}

type MarketplaceSource =
	| { type: "path"; path: string }
	| { type: "github"; owner: string; repo: string; slug: string }
	| { type: "git"; url: string }
	| { type: "url"; url: string }

export async function resolveAgentPackages(options: {
	agent: ResolvedAgent
	packages: CanonicalPackage[]
	tempRoot: string
	dryRun: boolean
}): Promise<SyncResult<{ packages: CanonicalPackage[]; warnings: string[] }>> {
	const pluginPackages = options.packages.filter(isClaudePluginPackage)
	const standardPackages = options.packages.filter(
		(pkg) => pkg.type !== "claude-plugin",
	)

	if (pluginPackages.length === 0) {
		return { ok: true, value: { packages: standardPackages, warnings: [] } }
	}

	const marketplaceCache = new Map<string, MarketplaceInfo>()

	if (options.agent.id === "claude-code") {
		const validation = await validateClaudePlugins(
			pluginPackages,
			options.tempRoot,
			marketplaceCache,
		)
		if (!validation.ok) {
			return validation
		}

		if (options.dryRun) {
			const names = pluginPackages.map((plugin) => plugin.plugin).join(", ")
			return {
				ok: true,
				value: {
					packages: standardPackages,
					warnings: [
						`Would install Claude plugins for ${options.agent.displayName}: ${names}.`,
					],
				},
			}
		}

		const installPlugins = await installClaudePlugins(
			pluginPackages,
			options.tempRoot,
			marketplaceCache,
		)
		if (!installPlugins.ok) {
			return installPlugins
		}

		return { ok: true, value: { packages: standardPackages, warnings: [] } }
	}

	const resolved = await resolveClaudePluginDependencies(
		pluginPackages,
		options.tempRoot,
		marketplaceCache,
	)
	if (!resolved.ok) {
		return resolved
	}

	return {
		ok: true,
		value: {
			packages: [...standardPackages, ...resolved.value],
			warnings: [],
		},
	}
}

function isClaudePluginPackage(pkg: CanonicalPackage): pkg is ClaudePluginPackage {
	return pkg.type === "claude-plugin"
}

async function validateClaudePlugins(
	plugins: ClaudePluginPackage[],
	tempRoot: string,
	cache: Map<string, MarketplaceInfo>,
): Promise<SyncResult<void>> {
	for (const plugin of plugins) {
		const marketplaceResult = await loadMarketplaceInfo(
			plugin.marketplace,
			String(plugin.origin.manifestPath),
			tempRoot,
			cache,
		)
		if (!marketplaceResult.ok) {
			return marketplaceResult
		}

		const marketplace = marketplaceResult.value
		const pluginEntry = findMarketplacePlugin(marketplace, plugin.plugin)
		if (!pluginEntry) {
			return failSync(
				"resolve",
				new Error(
					`Marketplace "${marketplace.name}" does not contain plugin "${plugin.plugin}".`,
				),
			)
		}
	}

	return { ok: true, value: undefined }
}

async function installClaudePlugins(
	plugins: ClaudePluginPackage[],
	tempRoot: string,
	cache: Map<string, MarketplaceInfo>,
): Promise<SyncResult<void>> {
	const addedMarketplaces = new Set<string>()
	const installedPlugins = new Set<string>()

	for (const plugin of plugins) {
		const marketplaceResult = await loadMarketplaceInfo(
			plugin.marketplace,
			String(plugin.origin.manifestPath),
			tempRoot,
			cache,
		)
		if (!marketplaceResult.ok) {
			return marketplaceResult
		}

		const marketplace = marketplaceResult.value
		const pluginEntry = findMarketplacePlugin(marketplace, plugin.plugin)
		if (!pluginEntry) {
			return failSync(
				"resolve",
				new Error(
					`Marketplace "${marketplace.name}" does not contain plugin "${plugin.plugin}".`,
				),
			)
		}

		if (!addedMarketplaces.has(plugin.marketplace)) {
			const addResult = await runClaudeCommand(
				`/plugin marketplace add ${plugin.marketplace}`,
			)
			if (!addResult.ok) {
				return addResult
			}
			addedMarketplaces.add(plugin.marketplace)
		}

		const installKey = `${plugin.plugin}@${marketplace.name}`
		if (installedPlugins.has(installKey)) {
			continue
		}

		const installResult = await runClaudeCommand(`/plugin install ${installKey}`)
		if (!installResult.ok) {
			return installResult
		}
		installedPlugins.add(installKey)
	}

	return { ok: true, value: undefined }
}

async function resolveClaudePluginDependencies(
	plugins: ClaudePluginPackage[],
	tempRoot: string,
	cache: Map<string, MarketplaceInfo>,
): Promise<SyncResult<CanonicalPackage[]>> {
	const resolved: CanonicalPackage[] = []

	for (const plugin of plugins) {
		const marketplaceResult = await loadMarketplaceInfo(
			plugin.marketplace,
			String(plugin.origin.manifestPath),
			tempRoot,
			cache,
		)
		if (!marketplaceResult.ok) {
			return marketplaceResult
		}

		const marketplace = marketplaceResult.value
		const pluginEntry = findMarketplacePlugin(marketplace, plugin.plugin)
		if (!pluginEntry) {
			return failSync(
				"resolve",
				new Error(
					`Marketplace "${marketplace.name}" does not contain plugin "${plugin.plugin}".`,
				),
			)
		}

		const sourceResult = await resolvePluginSource(
			pluginEntry.source,
			String(plugin.origin.alias),
			marketplace,
		)
		if (!sourceResult.ok) {
			return sourceResult
		}

		resolved.push(sourceResult.value)
	}

	return { ok: true, value: resolved }
}

function findMarketplacePlugin(
	marketplace: MarketplaceInfo,
	pluginName: string,
): MarketplacePluginEntry | undefined {
	return marketplace.plugins.find((plugin) => plugin.name === pluginName)
}

async function loadMarketplaceInfo(
	spec: string,
	sourcePath: string,
	tempRoot: string,
	cache: Map<string, MarketplaceInfo>,
): Promise<SyncResult<MarketplaceInfo>> {
	const cached = cache.get(spec)
	if (cached) {
		return { ok: true, value: cached }
	}

	const parsed = await parseMarketplaceSpec(spec, sourcePath)
	if (!parsed.ok) {
		return parsed
	}

	let rootPath: string
	let manifestPath: string
	let manifestContents: string

	if (parsed.value.type === "url") {
		manifestPath = parsed.value.url
		const fetched = await fetchMarketplaceUrl(parsed.value.url)
		if (!fetched.ok) {
			return fetched
		}
		manifestContents = fetched.value
		rootPath = tempRoot
	} else {
		if (parsed.value.type === "path") {
			const stats = await safeStat(parsed.value.path)
			if (!stats.ok) {
				return failSync("fetch", stats.error)
			}

			if (!stats.value) {
				return failSync(
					"fetch",
					new Error(`Marketplace path does not exist: ${parsed.value.path}`),
				)
			}

			if (!stats.value.isDirectory()) {
				return failSync(
					"fetch",
					new Error(
						`Marketplace path is not a directory: ${parsed.value.path}`,
					),
				)
			}

			rootPath = parsed.value.path
		} else if (parsed.value.type === "github") {
			const key = buildRepoKey("github", parsed.value.slug, undefined)
			const repoDir = buildRepoDir(tempRoot, key, "marketplace")
			const marketplaceOrigin = createMarketplaceOrigin(sourcePath)
			const repoResult = await fetchGithubRepository({
				destination: repoDir,
				origin: marketplaceOrigin,
				owner: parsed.value.owner,
				repo: parsed.value.repo,
				source: parsed.value.slug,
			})
			if (!repoResult.ok) {
				return failSync("fetch", repoResult.error)
			}
			rootPath = repoResult.value.repoPath
		} else {
			const key = buildRepoKey("git", parsed.value.url, undefined)
			const repoDir = buildRepoDir(tempRoot, key, "marketplace")
			const marketplaceOrigin = createMarketplaceOrigin(sourcePath)
			const repoResult = await fetchGitRepository({
				destination: repoDir,
				origin: marketplaceOrigin,
				remoteUrl: parsed.value.url,
				source: parsed.value.url,
			})
			if (!repoResult.ok) {
				return failSync("fetch", repoResult.error)
			}
			rootPath = repoResult.value.repoPath
		}

		manifestPath = path.join(rootPath, ".claude-plugin", "marketplace.json")
		const contents = await readTextFile(manifestPath)
		if (!contents.ok) {
			return failSync("fetch", contents.error)
		}
		manifestContents = contents.value
	}

	const parsedMarketplace = parseMarketplaceJson(manifestContents, manifestPath)
	if (!parsedMarketplace.ok) {
		return failSync("resolve", new Error(parsedMarketplace.error))
	}

	let pluginRootPath: string | undefined
	if (parsedMarketplace.value.pluginRoot) {
		if (parsed.value.type === "url") {
			return failSync(
				"resolve",
				new Error(
					"Marketplace pluginRoot is not supported for URL marketplaces.",
				),
			)
		}

		const resolvedRoot = resolveMarketplacePluginRoot(
			rootPath,
			parsedMarketplace.value.pluginRoot,
		)
		const stats = await safeStat(resolvedRoot)
		if (!stats.ok) {
			return failSync("fetch", stats.error)
		}
		if (!stats.value) {
			return failSync(
				"resolve",
				new Error(`Marketplace pluginRoot does not exist: ${resolvedRoot}`),
			)
		}
		if (!stats.value.isDirectory()) {
			return failSync(
				"resolve",
				new Error(`Marketplace pluginRoot is not a directory: ${resolvedRoot}`),
			)
		}
		pluginRootPath = resolvedRoot
	}

	const info: MarketplaceInfo = {
		manifestPath,
		name: parsedMarketplace.value.name,
		pluginRootPath,
		plugins: parsedMarketplace.value.plugins,
		rootPath,
		source: parsed.value,
	}

	cache.set(spec, info)
	return { ok: true, value: info }
}

async function parseMarketplaceSpec(
	spec: string,
	sourcePath: string,
): Promise<SyncResult<MarketplaceSource>> {
	const trimmed = spec.trim()
	if (!trimmed) {
		return failSync("resolve", new Error("Marketplace spec must not be empty."))
	}

	const marketplaceOrigin = createMarketplaceOrigin(sourcePath)
	const prefixed = stripGithubPrefix(trimmed)
	if (prefixed !== trimmed) {
		const parsed = parseGithubSlug(prefixed, marketplaceOrigin)
		if (!parsed.ok) {
			return failSync("resolve", parsed.error)
		}
		return {
			ok: true,
			value: {
				owner: parsed.value.owner,
				repo: parsed.value.repo,
				slug: prefixed,
				type: "github",
			},
		}
	}

	if (looksLikeMarketplaceJsonUrl(trimmed)) {
		return { ok: true, value: { type: "url", url: trimmed } }
	}

	if (looksLikeGitUrl(trimmed)) {
		return { ok: true, value: { type: "git", url: trimmed } }
	}

	const candidatePath = resolvePathFromSource(sourcePath, trimmed)
	const stats = await safeStat(candidatePath)
	if (!stats.ok) {
		return failSync("fetch", stats.error)
	}
	if (stats.value?.isDirectory()) {
		return { ok: true, value: { path: candidatePath, type: "path" } }
	}
	if (stats.value) {
		return failSync(
			"resolve",
			new Error(`Marketplace path is not a directory: ${candidatePath}`),
		)
	}

	const parsed = parseGithubSlug(trimmed, marketplaceOrigin)
	if (!parsed.ok) {
		return failSync("resolve", parsed.error)
	}

	return {
		ok: true,
		value: {
			owner: parsed.value.owner,
			repo: parsed.value.repo,
			slug: trimmed,
			type: "github",
		},
	}
}

async function fetchMarketplaceUrl(url: string): Promise<SyncResult<string>> {
	try {
		const response = await fetch(url)
		if (!response.ok) {
			return failSync(
				"fetch",
				new Error(
					`Marketplace request failed (${response.status} ${response.statusText}).`,
				),
			)
		}
		const text = await response.text()
		return { ok: true, value: text }
	} catch (error) {
		return failSync("fetch", error, `Unable to fetch marketplace URL: ${url}`)
	}
}

async function resolvePluginSource(
	source: unknown,
	alias: string,
	marketplace: MarketplaceInfo,
): Promise<SyncResult<CanonicalPackage>> {
	const declaration = await parsePluginSource(source, alias, marketplace)
	if (!declaration.ok) {
		return declaration
	}

	const baseDir = resolveMarketplacePluginBasePath(marketplace)
	const manifestPath = coerceAbsolutePath("agents.toml", baseDir)
	if (!manifestPath) {
		return failSync(
			"resolve",
			new Error(`Marketplace base path is invalid: ${baseDir}`),
		)
	}

	// Coerce the declaration to a validated dependency
	const coerced = coerceDependency(declaration.value, alias, manifestPath)
	if (!coerced.ok) {
		return failSync("resolve", coerced.error)
	}

	// Create origin for the plugin
	const origin: PackageOrigin = {
		alias: coerceAlias(alias) ?? (alias as Alias),
		manifestPath,
	}

	// Resolve to canonical package
	const canonical = resolveValidatedDependency(coerced.value, origin)
	return { ok: true, value: canonical }
}

async function parsePluginSource(
	source: unknown,
	alias: string,
	marketplace: MarketplaceInfo,
): Promise<SyncResult<DependencyDeclaration>> {
	if (typeof source === "string") {
		return parsePluginSourceString(source, alias, marketplace)
	}

	if (!isRecord(source)) {
		return failSync(
			"resolve",
			new Error(`Plugin "${alias}" source must be a string or object declaration.`),
		)
	}

	const sourceType = source.source
	if (typeof sourceType !== "string" || !sourceType.trim()) {
		return failSync(
			"resolve",
			new Error(
				`Plugin "${alias}" source must include a non-empty "source" field.`,
			),
		)
	}

	const normalizedType = sourceType.trim()
	const allowedKeys =
		normalizedType === "github"
			? new Set(["source", "repo"])
			: normalizedType === "url"
				? new Set(["source", "url"])
				: new Set(["source"])
	const unknownKeys = Object.keys(source).filter((key) => !allowedKeys.has(key))
	if (unknownKeys.length > 0) {
		return failSync(
			"resolve",
			new Error(
				`Plugin "${alias}" source has unknown keys: ${unknownKeys.join(", ")}.`,
			),
		)
	}

	if (normalizedType === "github") {
		const repoValue = source.repo
		if (typeof repoValue !== "string" || !repoValue.trim()) {
			return failSync(
				"resolve",
				new Error(`Plugin "${alias}" source repo must be a string.`),
			)
		}

		return {
			ok: true,
			value: {
				gh: stripGithubPrefix(repoValue.trim()),
			},
		}
	}

	if (normalizedType === "url") {
		const urlValue = source.url
		if (typeof urlValue !== "string" || !urlValue.trim()) {
			return failSync(
				"resolve",
				new Error(`Plugin "${alias}" source url must be a string.`),
			)
		}

		return {
			ok: true,
			value: {
				git: urlValue.trim(),
			},
		}
	}

	return failSync(
		"resolve",
		new Error(`Plugin "${alias}" source must use "github" or "url" for source type.`),
	)
}

async function parsePluginSourceString(
	source: string,
	alias: string,
	marketplace: MarketplaceInfo,
): Promise<SyncResult<DependencyDeclaration>> {
	const trimmed = source.trim()
	if (!trimmed) {
		return failSync(
			"resolve",
			new Error(`Plugin "${alias}" source must not be empty.`),
		)
	}

	if (marketplace.source.type === "url") {
		return failSync(
			"resolve",
			new Error(
				`Plugin "${alias}" uses a relative source, but marketplace URL sources do not support relative plugin paths.`,
			),
		)
	}

	const candidatePath = resolveMarketplacePluginPath(marketplace, trimmed)
	const stats = await safeStat(candidatePath)
	if (!stats.ok) {
		return failSync("fetch", stats.error)
	}
	if (stats.value?.isDirectory()) {
		return { ok: true, value: { path: candidatePath } }
	}
	if (stats.value) {
		return failSync(
			"resolve",
			new Error(`Plugin "${alias}" source path is not a directory.`),
		)
	}
	return failSync(
		"resolve",
		new Error(`Plugin "${alias}" source path does not exist: ${candidatePath}`),
	)
}

function stripGithubPrefix(value: string): string {
	if (value.startsWith("github:")) {
		return value.slice("github:".length)
	}
	if (value.startsWith("gh:")) {
		return value.slice("gh:".length)
	}
	return value
}

function resolveMarketplacePluginRoot(rootPath: string, pluginRoot: string): string {
	const expanded = expandHomePath(pluginRoot.trim())
	if (path.isAbsolute(expanded)) {
		return expanded
	}
	return path.resolve(rootPath, expanded)
}

function resolveMarketplacePluginBasePath(marketplace: MarketplaceInfo): string {
	return marketplace.pluginRootPath ?? marketplace.rootPath
}

function resolveMarketplacePluginPath(
	marketplace: MarketplaceInfo,
	spec: string,
): string {
	const expanded = expandHomePath(spec.trim())
	if (path.isAbsolute(expanded)) {
		return expanded
	}
	const baseDir = resolveMarketplacePluginBasePath(marketplace)
	return path.resolve(baseDir, expanded)
}

function resolvePathFromSource(sourcePath: string, spec: string): string {
	const expanded = expandHomePath(spec)
	if (path.isAbsolute(expanded)) {
		return expanded
	}

	return path.resolve(path.dirname(sourcePath), expanded)
}

function expandHomePath(value: string): string {
	if (value === "~") {
		return homedir()
	}

	if (value.startsWith("~/")) {
		return path.join(homedir(), value.slice(2))
	}

	return value
}

function looksLikeMarketplaceJsonUrl(value: string): boolean {
	if (!value.includes("://")) {
		return false
	}

	try {
		const parsed = new URL(value)
		return parsed.pathname.endsWith(".json")
	} catch {
		return false
	}
}

function looksLikeGitUrl(value: string): boolean {
	return value.startsWith("git@") || value.includes("://")
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function runClaudeCommand(command: string): Promise<SyncResult<void>> {
	try {
		await execFileAsync("claude", ["--command", command], {
			encoding: "utf8",
		})
		return { ok: true, value: undefined }
	} catch (error) {
		return failSync("install", error, `Failed to run Claude command: ${command}`)
	}
}
