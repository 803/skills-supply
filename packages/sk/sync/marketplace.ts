import { execFile } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import {
	type AbsolutePath,
	type Alias,
	coerceAbsolutePathDirect,
	coerceAlias,
	MARKETPLACE_FILENAME,
	type MarketplaceInfo,
	PLUGIN_DIR,
	parseMarketplace,
	resolvePluginSource,
	type ValidatedDeclaration,
} from "@skills-supply/core"
import type { ResolvedAgent } from "@/agents/types"
import { readTextFile, safeStat } from "@/io/fs"
import {
	fetchGithubRepository,
	fetchGitRepository,
	parseGithubSlug,
} from "@/packages/fetch"
import type { CanonicalPackage, ClaudePluginPackage } from "@/packages/types"
import { failSync } from "@/sync/errors"
import { buildRepoDir, buildRepoKey } from "@/sync/repo"
import type { SyncResult } from "@/sync/types"
import type { PackageOrigin } from "@/types/context"

// Create a fake origin for marketplace operations
function createMarketplaceOrigin(manifestPath: AbsolutePath): PackageOrigin {
	return {
		alias: coerceAlias("marketplace") ?? ("marketplace" as Alias),
		manifestPath,
	}
}

const execFileAsync = promisify(execFile)

interface MarketplaceResolved {
	info: MarketplaceInfo
	manifestPath: string
	basePath: AbsolutePath
	source: MarketplaceSource
}

type MarketplaceSource =
	| { type: "path"; path: AbsolutePath }
	| { type: "github"; owner: string; repo: string; slug: string }
	| { type: "git"; url: string }
	| { type: "url"; url: string }

type PluginSource = Extract<ValidatedDeclaration, { type: "github" | "git" | "local" }>

export type ResolvedClaudePlugin = {
	readonly canonical: ClaudePluginPackage
	readonly source: PluginSource
}

export async function resolveAgentPackages(options: {
	agent: ResolvedAgent
	packages: CanonicalPackage[]
	tempRoot: AbsolutePath
	dryRun: boolean
}): Promise<
	SyncResult<{
		packages: CanonicalPackage[]
		plugins: ResolvedClaudePlugin[]
		warnings: string[]
	}>
> {
	const pluginPackages = options.packages.filter(isClaudePluginPackage)
	const standardPackages = options.packages.filter(
		(pkg) => pkg.type !== "claude-plugin",
	)

	if (pluginPackages.length === 0) {
		return {
			ok: true,
			value: { packages: standardPackages, plugins: [], warnings: [] },
		}
	}

	const marketplaceCache = new Map<string, MarketplaceResolved>()

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
					plugins: [],
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

		return {
			ok: true,
			value: { packages: standardPackages, plugins: [], warnings: [] },
		}
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
			packages: standardPackages,
			plugins: resolved.value,
			warnings: [],
		},
	}
}

function isClaudePluginPackage(pkg: CanonicalPackage): pkg is ClaudePluginPackage {
	return pkg.type === "claude-plugin"
}

async function validateClaudePlugins(
	plugins: ClaudePluginPackage[],
	tempRoot: AbsolutePath,
	cache: Map<string, MarketplaceResolved>,
): Promise<SyncResult<void>> {
	for (const plugin of plugins) {
		const marketplaceResult = await loadMarketplaceInfo(
			plugin.marketplace,
			plugin.origin.manifestPath,
			tempRoot,
			cache,
		)
		if (!marketplaceResult.ok) {
			return marketplaceResult
		}

		const marketplace = marketplaceResult.value
		const pluginEntry = findMarketplacePlugin(marketplace.info, plugin.plugin)
		if (!pluginEntry) {
			return failSync("resolve", {
				message: `Marketplace "${marketplace.info.name}" does not contain plugin "${plugin.plugin}".`,
				target: "plugin",
				type: "not_found",
			})
		}
	}

	return { ok: true, value: undefined }
}

async function installClaudePlugins(
	plugins: ClaudePluginPackage[],
	tempRoot: AbsolutePath,
	cache: Map<string, MarketplaceResolved>,
): Promise<SyncResult<void>> {
	const addedMarketplaces = new Set<string>()
	const installedPlugins = new Set<string>()

	for (const plugin of plugins) {
		const marketplaceResult = await loadMarketplaceInfo(
			plugin.marketplace,
			plugin.origin.manifestPath,
			tempRoot,
			cache,
		)
		if (!marketplaceResult.ok) {
			return marketplaceResult
		}

		const marketplace = marketplaceResult.value
		const pluginEntry = findMarketplacePlugin(marketplace.info, plugin.plugin)
		if (!pluginEntry) {
			return failSync("resolve", {
				message: `Marketplace "${marketplace.info.name}" does not contain plugin "${plugin.plugin}".`,
				target: "plugin",
				type: "not_found",
			})
		}

		if (!addedMarketplaces.has(plugin.marketplace)) {
			const addResult = await runClaudePluginCommand(
				["marketplace", "add", plugin.marketplace],
				plugin.origin.manifestPath,
			)
			if (!addResult.ok) {
				return addResult
			}
			addedMarketplaces.add(plugin.marketplace)
		}

		const installKey = `${plugin.plugin}@${plugin.marketplace}`
		if (installedPlugins.has(installKey)) {
			continue
		}

		const installResult = await runClaudePluginCommand(
			["install", installKey],
			plugin.origin.manifestPath,
		)
		if (!installResult.ok) {
			return installResult
		}
		installedPlugins.add(installKey)
	}

	return { ok: true, value: undefined }
}

async function resolveClaudePluginDependencies(
	plugins: ClaudePluginPackage[],
	tempRoot: AbsolutePath,
	cache: Map<string, MarketplaceResolved>,
): Promise<SyncResult<ResolvedClaudePlugin[]>> {
	const resolved: ResolvedClaudePlugin[] = []

	for (const plugin of plugins) {
		const marketplaceResult = await loadMarketplaceInfo(
			plugin.marketplace,
			plugin.origin.manifestPath,
			tempRoot,
			cache,
		)
		if (!marketplaceResult.ok) {
			return marketplaceResult
		}

		const marketplace = marketplaceResult.value
		const sourceResult = resolvePluginSource(
			marketplace.info,
			plugin.plugin,
			marketplace.basePath,
		)
		if (!sourceResult.ok) {
			return failSync("resolve", sourceResult.error)
		}

		if (marketplace.source.type === "url" && sourceResult.value.type === "local") {
			return failSync("resolve", {
				field: "source",
				message: `Marketplace "${plugin.marketplace}" uses a local plugin source, but URL marketplaces do not support local paths.`,
				source: "manual",
				type: "validation",
			})
		}

		resolved.push({
			canonical: plugin,
			source: sourceResult.value,
		})
	}

	return { ok: true, value: resolved }
}

function findMarketplacePlugin(
	marketplace: MarketplaceInfo,
	pluginName: string,
): MarketplaceInfo["plugins"][number] | undefined {
	return marketplace.plugins.find((plugin) => plugin.name === pluginName)
}

async function loadMarketplaceInfo(
	spec: string,
	sourcePath: AbsolutePath,
	tempRoot: AbsolutePath,
	cache: Map<string, MarketplaceResolved>,
): Promise<SyncResult<MarketplaceResolved>> {
	const cached = cache.get(spec)
	if (cached) {
		return { ok: true, value: cached }
	}

	const parsed = await parseMarketplaceSpec(spec, sourcePath)
	if (!parsed.ok) {
		return parsed
	}

	let manifestPath: string
	let manifestContents: string
	let basePath: AbsolutePath

	if (parsed.value.type === "url") {
		manifestPath = parsed.value.url
		const fetched = await fetchMarketplaceUrl(parsed.value.url)
		if (!fetched.ok) {
			return fetched
		}
		manifestContents = fetched.value
		basePath = tempRoot
	} else {
		let rootPath: string
		if (parsed.value.type === "path") {
			const stats = await safeStat(parsed.value.path)
			if (!stats.ok) {
				return failSync("fetch", stats.error)
			}

			if (!stats.value) {
				return failSync("fetch", {
					message: `Marketplace path does not exist: ${parsed.value.path}`,
					path: parsed.value.path as AbsolutePath,
					target: "marketplace",
					type: "not_found",
				})
			}

			if (!stats.value.isDirectory()) {
				return failSync("fetch", {
					field: "path",
					message: `Marketplace path is not a directory: ${parsed.value.path}`,
					source: "manual",
					type: "validation",
				})
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
				spec: parsed.value.slug,
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
				spec: parsed.value.url,
			})
			if (!repoResult.ok) {
				return failSync("fetch", repoResult.error)
			}
			rootPath = repoResult.value.repoPath
		}

		const resolvedRoot = coerceAbsolutePathDirect(rootPath)
		if (!resolvedRoot) {
			return failSync("resolve", {
				field: "path",
				message: `Marketplace root is not absolute: ${rootPath}`,
				source: "manual",
				type: "validation",
			})
		}
		basePath = resolvedRoot

		manifestPath = path.join(rootPath, PLUGIN_DIR, MARKETPLACE_FILENAME)
		const contents = await readTextFile(manifestPath)
		if (!contents.ok) {
			return failSync("fetch", contents.error)
		}
		manifestContents = contents.value
	}

	const parsedMarketplace = parseMarketplace(manifestContents)
	if (!parsedMarketplace.ok) {
		const manifestAbsolute = coerceAbsolutePathDirect(manifestPath)
		return failSync("resolve", {
			...parsedMarketplace.error,
			...(manifestAbsolute ? { path: manifestAbsolute } : {}),
		})
	}

	const info: MarketplaceResolved = {
		basePath,
		info: parsedMarketplace.value,
		manifestPath,
		source: parsed.value,
	}

	cache.set(spec, info)
	return { ok: true, value: info }
}

async function parseMarketplaceSpec(
	spec: string,
	sourcePath: AbsolutePath,
): Promise<SyncResult<MarketplaceSource>> {
	const trimmed = spec.trim()
	if (!trimmed) {
		return failSync("resolve", {
			field: "marketplace",
			message: "Marketplace spec must not be empty.",
			source: "manual",
			type: "validation",
		})
	}

	const marketplaceOrigin = createMarketplaceOrigin(sourcePath)
	const prefixed = stripGithubPrefix(trimmed)
	if (prefixed !== trimmed) {
		const parsed = parseGithubSlug(prefixed, marketplaceOrigin)
		if (!parsed.ok) {
			return failSync("resolve", {
				cause: parsed.error,
				field: "marketplace",
				message: parsed.error.message,
				source: "manual",
				type: "validation",
			})
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
		return failSync("resolve", {
			field: "marketplace",
			message: `Marketplace path is not a directory: ${candidatePath}`,
			source: "manual",
			type: "validation",
		})
	}

	const parsed = parseGithubSlug(trimmed, marketplaceOrigin)
	if (!parsed.ok) {
		return failSync("resolve", {
			cause: parsed.error,
			field: "marketplace",
			message: parsed.error.message,
			source: "manual",
			type: "validation",
		})
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
			return failSync("fetch", {
				message: `Marketplace request failed (${response.status} ${response.statusText}).`,
				source: url,
				status: response.status,
				type: "network",
			})
		}
		const text = await response.text()
		return { ok: true, value: text }
	} catch (error) {
		return failSync("fetch", {
			message: `Unable to fetch marketplace URL: ${url}.`,
			rawError: error instanceof Error ? error : undefined,
			source: url,
			type: "network",
		})
	}
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

function resolvePathFromSource(sourcePath: AbsolutePath, spec: string): AbsolutePath {
	const expanded = expandHomePath(spec)
	if (path.isAbsolute(expanded)) {
		return expanded as AbsolutePath
	}

	return path.resolve(path.dirname(sourcePath), expanded) as AbsolutePath
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
		return parsed.pathname.endsWith("marketplace.json")
	} catch {
		return false
	}
}

function looksLikeGitUrl(value: string): boolean {
	return value.startsWith("git@") || value.includes("://")
}

async function runClaudePluginCommand(
	args: string[],
	contextPath: AbsolutePath,
): Promise<SyncResult<void>> {
	try {
		await execFileAsync("claude", ["plugin", ...args], {
			encoding: "utf8",
		})
		return { ok: true, value: undefined }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		// Treat "already installed" as success for marketplace add
		if (message.includes("already installed")) {
			return { ok: true, value: undefined }
		}
		return failSync("install", {
			message: `Failed to run: claude plugin ${args.join(" ")}`,
			operation: "execFile",
			path: contextPath,
			rawError: error instanceof Error ? error : undefined,
			type: "io",
		})
	}
}
