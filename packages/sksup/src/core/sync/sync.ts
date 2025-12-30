import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { AgentInstallPlan } from "@/core/agents/install"
import { applyAgentInstall, planAgentInstall } from "@/core/agents/install"
import { reconcileAgentSkills } from "@/core/agents/reconcile"
import { detectInstalledAgents, getAgentById } from "@/core/agents/registry"
import { buildAgentState, readAgentState, writeAgentState } from "@/core/agents/state"
import type { AgentDefinition } from "@/core/agents/types"
import { readTextFile, removePath, safeStat } from "@/core/io/fs"
import { discoverManifests } from "@/core/manifest/discover"
import { mergeManifests } from "@/core/manifest/merge"
import { parseManifest } from "@/core/manifest/parse"
import type {
	DependencyDeclaration,
	Manifest,
	MergedManifest,
} from "@/core/manifest/types"
import { detectPackageType } from "@/core/packages/detect"
import { extractSkills } from "@/core/packages/extract"
import {
	fetchGithubRepository,
	fetchGitRepository,
	fetchLocalPackage,
	joinRepoPath,
	normalizeSparsePath,
	parseGithubSlug,
} from "@/core/packages/fetch"
import { resolvePackageDeclaration } from "@/core/packages/resolve"
import type {
	CanonicalPackage,
	ClaudePluginPackage,
	FetchedPackage,
	GithubPackage,
	GitPackage,
	GitRef,
} from "@/core/packages/types"
import { failSync } from "@/core/sync/errors"
import type {
	ExtractedPackage,
	SyncOptions,
	SyncResult,
	SyncSummary,
} from "@/core/sync/types"
import { validateExtractedPackages } from "@/core/sync/validate"

const execFileAsync = promisify(execFile)

interface AgentSyncSummary {
	agent: AgentDefinition
	installed: number
	removed: number
	warnings: string[]
}

interface RepoGroupBase {
	alias: string
	fullCheckout: boolean
	key: string
	packages: NormalizedPackage[]
	ref?: GitRef
	source: string
	sparsePaths: Set<string>
}

interface GithubGroup extends RepoGroupBase {
	type: "github"
	owner: string
	repo: string
}

interface GitGroup extends RepoGroupBase {
	type: "git"
	remoteUrl: string
}

type RepoGroup = GithubGroup | GitGroup

interface NormalizedPackage {
	canonical: GithubPackage | GitPackage
	normalizedPath?: string
}

interface MarketplacePluginEntry {
	name: string
	source: unknown
}

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

export async function runSync(options: SyncOptions): Promise<SyncResult<SyncSummary>> {
	const manifestResult = await loadManifests(process.cwd())
	if (!manifestResult.ok) {
		return manifestResult
	}

	const mergedResult = mergeManifests(manifestResult.value)
	if (!mergedResult.ok) {
		return failSync("merge", mergedResult.error)
	}

	const packageResult = resolveMergedPackages(mergedResult.value)
	if (!packageResult.ok) {
		return packageResult
	}

	const agentsResult = await resolveAgents(mergedResult.value)
	if (!agentsResult.ok) {
		return agentsResult
	}

	const warnings: string[] = []
	let installed = 0
	let removed = 0

	for (const agent of agentsResult.value) {
		const agentResult = await syncAgent(agent, packageResult.value, options)
		if (!agentResult.ok) {
			return agentResult
		}

		installed += agentResult.value.installed
		removed += agentResult.value.removed
		warnings.push(...agentResult.value.warnings)
	}

	return {
		ok: true,
		value: {
			agents: agentsResult.value.map((agent) => agent.displayName),
			dependencies: packageResult.value.length,
			dryRun: options.dryRun,
			installed,
			manifests: manifestResult.value.length,
			removed,
			warnings,
		},
	}
}

async function loadManifests(startDir: string): Promise<SyncResult<Manifest[]>> {
	const discovered = await discoverManifests(startDir)
	if (!discovered.ok) {
		return failSync("discover", discovered.error)
	}

	if (discovered.value.length === 0) {
		return failSync("discover", new Error("No package.toml files were found."))
	}

	const manifests: Manifest[] = []
	for (const manifestPath of discovered.value) {
		const contents = await readTextFile(manifestPath)
		if (!contents.ok) {
			return failSync("parse", contents.error)
		}

		const parsed = parseManifest(contents.value, manifestPath)
		if (!parsed.ok) {
			return failSync("parse", parsed.error)
		}

		manifests.push(parsed.value)
	}

	return { ok: true, value: manifests }
}

function resolveMergedPackages(merged: MergedManifest): SyncResult<CanonicalPackage[]> {
	const resolved: CanonicalPackage[] = []

	for (const [alias, entry] of Object.entries(merged.dependencies)) {
		const result = resolvePackageDeclaration(
			alias,
			entry.declaration,
			entry.sourcePath,
		)
		if (!result.ok) {
			return failSync("resolve", result.error)
		}

		resolved.push(result.value)
	}

	return { ok: true, value: resolved }
}

async function resolveAgents(
	merged: MergedManifest,
): Promise<SyncResult<AgentDefinition[]>> {
	const agentEntries = Object.entries(merged.agents)

	if (agentEntries.length > 0) {
		const agents: AgentDefinition[] = []
		for (const [agentId, enabled] of agentEntries) {
			const lookup = getAgentById(agentId)
			if (!lookup.ok) {
				return failSync("agents", lookup.error)
			}

			if (enabled) {
				agents.push(lookup.value)
			}
		}

		if (agents.length === 0) {
			return failSync("agents", new Error("No agents are enabled in the manifest."))
		}

		return { ok: true, value: agents }
	}

	const detected = await detectInstalledAgents()
	if (!detected.ok) {
		return failSync("agents", detected.error)
	}

	if (detected.value.length === 0) {
		return failSync("agents", new Error("No installed agents detected."))
	}

	return { ok: true, value: detected.value }
}

async function syncAgent(
	agent: AgentDefinition,
	packages: CanonicalPackage[],
	options: SyncOptions,
): Promise<SyncResult<AgentSyncSummary>> {
	const tempRootResult = await createTempRoot(agent.id)
	if (!tempRootResult.ok) {
		return tempRootResult
	}

	let warnings: string[] = []
	let result: SyncResult<AgentSyncSummary>

	try {
		const marketplaceCache = new Map<string, MarketplaceInfo>()
		const pluginPackages = packages.filter(isClaudePluginPackage)
		const standardPackages = packages.filter((pkg) => pkg.type !== "claude-plugin")

		let resolvedPackages = standardPackages

		if (pluginPackages.length > 0) {
			if (agent.id === "claude-code") {
				const validation = await validateClaudePlugins(
					pluginPackages,
					tempRootResult.value,
					marketplaceCache,
				)
				if (!validation.ok) {
					result = validation
					return result
				}

				if (options.dryRun) {
					const names = pluginPackages.map((plugin) => plugin.plugin).join(", ")
					warnings = warnings.concat(
						`Would install Claude plugins for ${agent.displayName}: ${names}.`,
					)
				} else {
					const installPlugins = await installClaudePlugins(
						pluginPackages,
						tempRootResult.value,
						marketplaceCache,
					)
					if (!installPlugins.ok) {
						result = installPlugins
						return result
					}
				}
			} else {
				const resolved = await resolveClaudePluginDependencies(
					pluginPackages,
					tempRootResult.value,
					marketplaceCache,
				)
				if (!resolved.ok) {
					result = resolved
					return result
				}

				resolvedPackages = standardPackages.concat(resolved.value)
			}
		}

		const fetchedResult = await fetchPackagesForAgent(
			resolvedPackages,
			tempRootResult.value,
		)
		if (!fetchedResult.ok) {
			result = fetchedResult
			return result
		}

		const extractedResult = await detectAndExtractPackages(fetchedResult.value)
		if (!extractedResult.ok) {
			result = extractedResult
			return result
		}

		const validation = validateExtractedPackages(extractedResult.value)
		if (!validation.ok) {
			result = validation
			return result
		}

		const installable = extractedResult.value.map((pkg) => ({
			canonical: pkg.canonical,
			prefix: pkg.prefix,
			skills: pkg.skills,
		}))

		const planResult = planAgentInstall(agent, installable)
		if (!planResult.ok) {
			result = failSync("install", planResult.error)
			return result
		}

		const desiredNames = planResult.value.tasks.map((task) => task.targetName)
		const desiredSet = new Set(desiredNames)

		const stateResult = await readAgentState(agent)
		if (!stateResult.ok) {
			result = failSync("reconcile", stateResult.error)
			return result
		}

		const previousState = stateResult.value
		if (!previousState) {
			warnings = warnings.concat(
				`No prior state for ${agent.displayName}; skipping stale skill removal.`,
			)
		}

		const managedSkills = new Set(previousState?.skills ?? [])
		const preflight = await preflightTargets(planResult.value, managedSkills)
		if (!preflight.ok) {
			result = preflight
			return result
		}

		if (options.dryRun) {
			const removed = previousState
				? countStaleSkills(previousState.skills, desiredSet)
				: 0
			result = {
				ok: true,
				value: {
					agent,
					installed: desiredNames.length,
					removed,
					warnings,
				},
			}
			return result
		}

		const removalResult = await removeManagedTargets(preflight.value)
		if (!removalResult.ok) {
			result = removalResult
			return result
		}

		const installResult = await applyAgentInstall(planResult.value)
		if (!installResult.ok) {
			result = failSync("install", installResult.error)
			return result
		}

		const reconcileResult = await reconcileAgentSkills(
			agent,
			previousState,
			desiredSet,
		)
		if (!reconcileResult.ok) {
			result = failSync("reconcile", reconcileResult.error)
			return result
		}

		const state = buildAgentState(desiredNames)
		const writeResult = await writeAgentState(agent, state)
		if (!writeResult.ok) {
			result = failSync("reconcile", writeResult.error)
			return result
		}

		result = {
			ok: true,
			value: {
				agent,
				installed: installResult.value.length,
				removed: reconcileResult.value.removed.length,
				warnings,
			},
		}
		return result
	} finally {
		await removePath(tempRootResult.value)
	}
}

async function createTempRoot(agentId: string): Promise<SyncResult<string>> {
	try {
		const prefix = path.join(tmpdir(), `sksup-${agentId}-`)
		const tempRoot = await mkdtemp(prefix)
		return { ok: true, value: tempRoot }
	} catch (error) {
		return failSync("fetch", error, "Unable to create temporary directory.")
	}
}

async function fetchPackagesForAgent(
	packages: CanonicalPackage[],
	tempRoot: string,
): Promise<SyncResult<FetchedPackage[]>> {
	const fetched: FetchedPackage[] = []

	for (const pkg of packages) {
		if (pkg.type === "claude-plugin") {
			return failSync(
				"fetch",
				new Error("Claude plugin dependencies must be resolved before fetch."),
			)
		}
	}

	for (const pkg of packages) {
		if (pkg.type === "registry") {
			return failSync(
				"fetch",
				new Error("Registry packages are not supported yet."),
			)
		}
	}

	const groupResult = buildRepoGroups(packages)
	if (!groupResult.ok) {
		return groupResult
	}

	for (const group of groupResult.value) {
		const repoDir = buildRepoDir(tempRoot, group.key, group.alias)
		const sparsePaths = group.fullCheckout ? undefined : [...group.sparsePaths].sort()

		const repoResult =
			group.type === "github"
				? await fetchGithubRepository({
						alias: group.alias,
						destination: repoDir,
						owner: group.owner,
						ref: group.ref,
						repo: group.repo,
						source: group.source,
						sparsePaths,
					})
				: await fetchGitRepository({
						alias: group.alias,
						destination: repoDir,
						ref: group.ref,
						remoteUrl: group.remoteUrl,
						source: group.source,
						sparsePaths,
					})

		if (!repoResult.ok) {
			return failSync("fetch", repoResult.error)
		}

		for (const member of group.packages) {
			const packagePath = member.normalizedPath
				? joinRepoPath(repoResult.value.repoPath, member.normalizedPath)
				: repoResult.value.repoPath
			fetched.push({
				canonical: member.canonical,
				packagePath,
				repoPath: repoResult.value.repoPath,
			})
		}
	}

	for (const pkg of packages) {
		if (pkg.type !== "local") {
			continue
		}

		const localResult = await fetchLocalPackage(pkg)
		if (!localResult.ok) {
			return failSync("fetch", localResult.error)
		}
		fetched.push(localResult.value)
	}

	return { ok: true, value: fetched }
}

function buildRepoGroups(packages: CanonicalPackage[]): SyncResult<RepoGroup[]> {
	const groups = new Map<string, RepoGroup>()

	for (const pkg of packages) {
		if (pkg.type === "github") {
			const parsed = parseGithubSlug(pkg.gh, pkg.alias)
			if (!parsed.ok) {
				return failSync("fetch", parsed.error)
			}

			const pathResult = normalizeSparsePath(pkg.path, pkg.alias, pkg.gh)
			if (!pathResult.ok) {
				return failSync("fetch", pathResult.error)
			}

			const key = buildRepoKey("github", pkg.gh, pkg.ref)
			const group = getOrCreateGithubGroup(
				groups,
				key,
				pkg,
				parsed.value.owner,
				parsed.value.repo,
			)
			pushGroupMember(group, pkg, pathResult.value)
			continue
		}

		if (pkg.type === "git") {
			const pathResult = normalizeSparsePath(pkg.path, pkg.alias, pkg.url)
			if (!pathResult.ok) {
				return failSync("fetch", pathResult.error)
			}

			const key = buildRepoKey("git", pkg.normalizedUrl, pkg.ref)
			const group = getOrCreateGitGroup(groups, key, pkg)
			pushGroupMember(group, pkg, pathResult.value)
		}
	}

	return { ok: true, value: [...groups.values()] }
}

function getOrCreateGithubGroup(
	groups: Map<string, RepoGroup>,
	key: string,
	pkg: GithubPackage,
	owner: string,
	repo: string,
): GithubGroup {
	const existing = groups.get(key)
	if (existing && existing.type === "github") {
		return existing
	}

	const group: GithubGroup = {
		alias: pkg.alias,
		fullCheckout: false,
		key,
		owner,
		packages: [],
		ref: pkg.ref,
		repo,
		source: pkg.gh,
		sparsePaths: new Set<string>(),
		type: "github",
	}

	groups.set(key, group)
	return group
}

function getOrCreateGitGroup(
	groups: Map<string, RepoGroup>,
	key: string,
	pkg: GitPackage,
): GitGroup {
	const existing = groups.get(key)
	if (existing && existing.type === "git") {
		return existing
	}

	const group: GitGroup = {
		alias: pkg.alias,
		fullCheckout: false,
		key,
		packages: [],
		ref: pkg.ref,
		remoteUrl: pkg.url,
		source: pkg.url,
		sparsePaths: new Set<string>(),
		type: "git",
	}

	groups.set(key, group)
	return group
}

function pushGroupMember(
	group: RepoGroup,
	pkg: GithubPackage | GitPackage,
	normalizedPath: string | undefined,
): void {
	group.packages.push({ canonical: pkg, normalizedPath })
	if (!normalizedPath) {
		group.fullCheckout = true
		return
	}

	group.sparsePaths.add(normalizedPath)
}

function buildRepoKey(
	type: "github" | "git",
	identity: string,
	ref: GitRef | undefined,
): string {
	return `${type}:${identity}:${refKey(ref)}`
}

function refKey(ref: GitRef | undefined): string {
	if (!ref) {
		return "default"
	}

	if ("tag" in ref) {
		return `tag:${ref.tag}`
	}

	if ("branch" in ref) {
		return `branch:${ref.branch}`
	}

	return `rev:${ref.rev}`
}

function buildRepoDir(tempRoot: string, key: string, alias: string): string {
	const hash = createHash("sha256").update(key).digest("hex").slice(0, 12)
	const safeAlias = alias
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "")
	const dirName = safeAlias ? `${safeAlias}-${hash}` : hash
	return path.join(tempRoot, dirName)
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
			plugin.sourcePath,
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
			plugin.sourcePath,
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
			plugin.sourcePath,
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
			plugin.alias,
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
			const repoResult = await fetchGithubRepository({
				alias: "marketplace",
				destination: repoDir,
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
			const repoResult = await fetchGitRepository({
				alias: "marketplace",
				destination: repoDir,
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
		return parsedMarketplace
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

	const prefixed = stripGithubPrefix(trimmed)
	if (prefixed !== trimmed) {
		const parsed = parseGithubSlug(prefixed, "marketplace")
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

	const parsed = parseGithubSlug(trimmed, "marketplace")
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

function parseMarketplaceJson(
	contents: string,
	manifestPath: string,
): SyncResult<{ name: string; plugins: MarketplacePluginEntry[]; pluginRoot?: string }> {
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		return failSync("resolve", error, `Invalid JSON in ${manifestPath}.`)
	}

	if (!isRecord(parsed)) {
		return failSync(
			"resolve",
			new Error(`Marketplace manifest must be a JSON object.`),
		)
	}

	const nameValue = parsed.name
	if (typeof nameValue !== "string" || !nameValue.trim()) {
		return failSync(
			"resolve",
			new Error("Marketplace manifest must include a non-empty name."),
		)
	}

	const pluginsValue = parsed.plugins
	if (!Array.isArray(pluginsValue)) {
		return failSync(
			"resolve",
			new Error("Marketplace manifest must include a plugins array."),
		)
	}

	const plugins: MarketplacePluginEntry[] = []
	for (const entry of pluginsValue) {
		if (!isRecord(entry)) {
			return failSync("resolve", new Error("Marketplace plugins must be objects."))
		}

		const pluginName = entry.name
		if (typeof pluginName !== "string" || !pluginName.trim()) {
			return failSync(
				"resolve",
				new Error("Marketplace plugins must include a non-empty name."),
			)
		}

		if (!("source" in entry)) {
			return failSync(
				"resolve",
				new Error(`Marketplace plugin "${pluginName}" is missing source.`),
			)
		}

		plugins.push({
			name: pluginName.trim(),
			source: entry.source,
		})
	}

	let pluginRoot: string | undefined
	if ("metadata" in parsed && parsed.metadata !== undefined) {
		const metadata = parsed.metadata
		if (!isRecord(metadata)) {
			return failSync(
				"resolve",
				new Error("Marketplace metadata must be a JSON object."),
			)
		}

		if ("pluginRoot" in metadata) {
			const pluginRootValue = metadata.pluginRoot
			if (typeof pluginRootValue !== "string" || !pluginRootValue.trim()) {
				return failSync(
					"resolve",
					new Error(
						"Marketplace metadata.pluginRoot must be a non-empty string.",
					),
				)
			}
			pluginRoot = pluginRootValue.trim()
		}
	}

	return { ok: true, value: { name: nameValue.trim(), pluginRoot, plugins } }
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
	const resolved = resolvePackageDeclaration(
		alias,
		declaration.value,
		path.join(baseDir, "package.toml"),
	)
	if (!resolved.ok) {
		return failSync("resolve", resolved.error)
	}

	return { ok: true, value: resolved.value }
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

async function detectAndExtractPackages(
	fetched: FetchedPackage[],
): Promise<SyncResult<ExtractedPackage[]>> {
	const extracted: ExtractedPackage[] = []

	for (const pkg of fetched) {
		const detection = await detectPackageType(pkg.packagePath)
		if (!detection.ok) {
			return failSync("detect", detection.error)
		}

		const skills = await extractSkills(detection.value)
		if (!skills.ok) {
			return failSync("extract", skills.error)
		}

		extracted.push({
			canonical: pkg.canonical,
			prefix: pkg.canonical.alias,
			skills: skills.value,
		})
	}

	return { ok: true, value: extracted }
}

async function preflightTargets(
	plan: AgentInstallPlan,
	managedSkills: Set<string>,
): Promise<SyncResult<string[]>> {
	const removable: string[] = []

	for (const task of plan.tasks) {
		const stats = await safeStat(task.targetPath)
		if (!stats.ok) {
			return failSync("install", stats.error)
		}

		if (!stats.value) {
			continue
		}

		if (!managedSkills.has(task.targetName)) {
			return failSync(
				"install",
				new Error(
					`Skill target already exists and is not managed by sksup: ${task.targetName}`,
				),
			)
		}

		removable.push(task.targetPath)
	}

	return { ok: true, value: removable }
}

async function removeManagedTargets(paths: string[]): Promise<SyncResult<void>> {
	for (const targetPath of paths) {
		const removal = await removePath(targetPath)
		if (!removal.ok) {
			return failSync("install", removal.error)
		}
	}

	return { ok: true, value: undefined }
}

function countStaleSkills(skills: string[], desired: Set<string>): number {
	let count = 0
	for (const skill of skills) {
		if (!desired.has(skill)) {
			count += 1
		}
	}
	return count
}
