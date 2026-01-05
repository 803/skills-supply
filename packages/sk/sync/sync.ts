import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	type AbsolutePath,
	coerceAbsolutePathDirect,
	type DetectedStructure,
	detectStructure,
	type GitRef,
	type ManifestInfo,
	type Result,
	type ValidatedDeclaration,
	validateManifest,
} from "@skills-supply/core"
import type { AgentInstallPlan } from "@/agents/install"
import { applyAgentInstall, planAgentInstall } from "@/agents/install"
import { reconcileAgentSkills } from "@/agents/reconcile"
import { buildAgentState, readAgentState, writeAgentState } from "@/agents/state"
import type { ResolvedAgent } from "@/agents/types"
import { readTextFile, removePath, safeStat } from "@/io/fs"
import { extractSkills } from "@/packages/extract"
import {
	fetchGithubRepository,
	fetchGitRepository,
	fetchLocalPackage,
	joinRepoPath,
	normalizeSparsePath,
	parseGithubSlug,
} from "@/packages/fetch"
import { resolveManifestPackages } from "@/packages/resolve"
import type {
	CanonicalPackage,
	FetchedPackage,
	GithubPackage,
	GitPackage,
} from "@/packages/types"
import { failSync } from "@/sync/errors"
import { type ResolvedClaudePlugin, resolveAgentPackages } from "@/sync/marketplace"
import { buildRepoDir, buildRepoKey } from "@/sync/repo"
import type { ExtractedPackage, SyncOptions, SyncResult, SyncSummary } from "@/sync/types"
import { validateExtractedPackages } from "@/sync/validate"
import type { PackageOrigin } from "@/types/context"
import type { SkError } from "@/types/errors"

interface AgentSyncSummary {
	agent: ResolvedAgent
	installed: number
	removed: number
	warnings: string[]
}

interface RepoGroupBase {
	origin: PackageOrigin
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

export async function runSync(options: SyncOptions): Promise<SyncResult<SyncSummary>> {
	const { agents, manifest } = options
	if (agents.length === 0) {
		return failSync("agents", {
			field: "agents",
			message: "No agents provided for sync.",
			source: "manual",
			type: "validation",
		})
	}

	const packages = resolveManifestPackages(manifest)
	if (packages.length === 0) {
		return syncWithoutDependencies(agents, options.dryRun)
	}

	const warnings: string[] = []
	let installed = 0
	let removed = 0

	for (const agent of agents) {
		const agentResult = await syncAgent(agent, packages, options)
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
			agents: agents.map((agent) => agent.displayName),
			dependencies: packages.length,
			dryRun: options.dryRun,
			installed,
			manifests: 1,
			removed,
			warnings,
		},
	}
}

async function syncWithoutDependencies(
	agents: ResolvedAgent[],
	dryRun: boolean,
): Promise<SyncResult<SyncSummary>> {
	let removed = 0
	let hasState = false
	const warnings: string[] = []

	for (const agent of agents) {
		const stateResult = await readAgentState(agent)
		if (!stateResult.ok) {
			return failSync("reconcile", stateResult.error)
		}

		const previousState = stateResult.value
		if (!previousState) {
			continue
		}

		hasState = true
		if (dryRun) {
			removed += previousState.skills.length
			continue
		}

		const reconcileResult = await reconcileAgentSkills(
			agent,
			previousState,
			new Set<string>(),
		)
		if (!reconcileResult.ok) {
			return failSync("reconcile", reconcileResult.error)
		}

		removed += reconcileResult.value.removed.length
		const state = buildAgentState([])
		const writeResult = await writeAgentState(agent, state)
		if (!writeResult.ok) {
			return failSync("reconcile", writeResult.error)
		}
	}

	return {
		ok: true,
		value: {
			agents: agents.map((agent) => agent.displayName),
			dependencies: 0,
			dryRun,
			installed: 0,
			manifests: 1,
			noOpReason: hasState ? undefined : "no-dependencies",
			removed,
			warnings,
		},
	}
}

async function syncAgent(
	agent: ResolvedAgent,
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
		const packageResolution = await resolveAgentPackages({
			agent,
			dryRun: options.dryRun,
			packages,
			tempRoot: tempRootResult.value,
		})
		if (!packageResolution.ok) {
			result = packageResolution
			return result
		}

		warnings = warnings.concat(packageResolution.value.warnings)
		const resolvedPackages = packageResolution.value.packages
		const resolvedPlugins = packageResolution.value.plugins

		const fetchedResult = await fetchPackagesForAgent(
			resolvedPackages,
			tempRootResult.value,
		)
		if (!fetchedResult.ok) {
			result = fetchedResult
			return result
		}

		const pluginFetchResult = await fetchClaudePluginPackages(
			resolvedPlugins,
			tempRootResult.value,
		)
		if (!pluginFetchResult.ok) {
			result = pluginFetchResult
			return result
		}

		const extractedResult = await detectAndExtractPackages([
			...fetchedResult.value,
			...pluginFetchResult.value,
		])
		if (!extractedResult.ok) {
			result = extractedResult
			return result
		}

		warnings = warnings.concat(extractedResult.value.warnings)
		const extractedPackages = extractedResult.value.packages

		const validation = validateExtractedPackages(extractedPackages)
		if (!validation.ok) {
			result = validation
			return result
		}

		const installable = extractedPackages.map((pkg) => ({
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

		const managedSkills = new Set<string>(previousState?.skills ?? [])
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

async function createTempRoot(agentId: string): Promise<SyncResult<AbsolutePath>> {
	try {
		const prefix = path.join(tmpdir(), `sk-${agentId}-`)
		const tempRoot = await mkdtemp(prefix)
		const absoluteTempRoot = coerceAbsolutePathDirect(tempRoot)
		if (!absoluteTempRoot) {
			return failSync("fetch", {
				field: "path",
				message: `Invalid temp directory: ${tempRoot}`,
				source: "manual",
				type: "validation",
			})
		}
		return { ok: true, value: absoluteTempRoot }
	} catch (error) {
		const absolutePrefix = coerceAbsolutePathDirect(
			path.join(tmpdir(), `sk-${agentId}-`),
		)
		return failSync("fetch", {
			message: "Unable to create temporary directory.",
			operation: "mkdtemp",
			path:
				absolutePrefix ?? (path.join(tmpdir(), `sk-${agentId}-`) as AbsolutePath),
			rawError: error instanceof Error ? error : undefined,
			type: "io",
		})
	}
}

async function fetchPackagesForAgent(
	packages: CanonicalPackage[],
	tempRoot: string,
): Promise<SyncResult<FetchedPackage[]>> {
	const fetched: FetchedPackage[] = []

	for (const pkg of packages) {
		if (pkg.type === "claude-plugin") {
			return failSync("fetch", {
				field: "dependencies",
				message: "Claude plugin dependencies must be resolved before fetch.",
				source: "manual",
				type: "validation",
			})
		}
	}

	for (const pkg of packages) {
		if (pkg.type === "registry") {
			return failSync("fetch", {
				field: "dependencies",
				message: "Registry packages are not supported yet.",
				source: "manual",
				type: "validation",
			})
		}
	}

	const groupResult = buildRepoGroups(packages)
	if (!groupResult.ok) {
		return groupResult
	}

	for (const group of groupResult.value) {
		const repoDir = buildRepoDir(tempRoot, group.key, String(group.origin.alias))
		const sparsePaths = group.fullCheckout ? undefined : [...group.sparsePaths].sort()

		const repoResult =
			group.type === "github"
				? await fetchGithubRepository({
						destination: repoDir,
						origin: group.origin,
						owner: group.owner,
						ref: group.ref,
						repo: group.repo,
						sparsePaths,
						spec: group.source,
					})
				: await fetchGitRepository({
						destination: repoDir,
						origin: group.origin,
						ref: group.ref,
						remoteUrl: group.remoteUrl,
						sparsePaths,
						spec: group.source,
					})

		if (!repoResult.ok) {
			return failSync("fetch", repoResult.error)
		}

		const repoPath = coerceAbsolutePathDirect(repoResult.value.repoPath)
		if (!repoPath) {
			return failSync("fetch", {
				field: "path",
				message: `Invalid repo path: ${repoResult.value.repoPath}`,
				source: "manual",
				type: "validation",
			})
		}

		for (const member of group.packages) {
			const packagePath = member.normalizedPath
				? joinRepoPath(repoPath, member.normalizedPath)
				: repoPath
			const absolutePackagePath = coerceAbsolutePathDirect(packagePath)
			if (!absolutePackagePath) {
				return failSync("fetch", {
					field: "path",
					message: `Invalid package path: ${packagePath}`,
					source: "manual",
					type: "validation",
				})
			}
			fetched.push({
				canonical: member.canonical,
				packagePath: absolutePackagePath,
				repoPath,
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

async function fetchClaudePluginPackages(
	plugins: ResolvedClaudePlugin[],
	tempRoot: AbsolutePath,
): Promise<SyncResult<FetchedPackage[]>> {
	if (plugins.length === 0) {
		return { ok: true, value: [] }
	}

	const fetched: FetchedPackage[] = []
	const repoCache = new Map<string, AbsolutePath>()

	for (const plugin of plugins) {
		const source = plugin.source

		if (source.type === "local") {
			const stats = await safeStat(source.path)
			if (!stats.ok) {
				return failSync("fetch", stats.error)
			}

			if (!stats.value) {
				return failSync("fetch", {
					field: "source",
					message: `Plugin source does not exist: ${source.path}`,
					path: source.path,
					source: "manual",
					type: "validation",
				})
			}

			if (!stats.value.isDirectory()) {
				return failSync("fetch", {
					field: "source",
					message: `Plugin source is not a directory: ${source.path}`,
					path: source.path,
					source: "manual",
					type: "validation",
				})
			}

			fetched.push({
				canonical: plugin.canonical,
				packagePath: source.path,
				repoPath: source.path,
			})
			continue
		}

		if (source.type === "github") {
			const parsed = parseGithubSlug(source.gh, plugin.canonical.origin)
			if (!parsed.ok) {
				return failSync("fetch", parsed.error)
			}

			const key = buildRepoKey("github", source.gh, undefined)
			let repoPath = repoCache.get(key)
			if (!repoPath) {
				const repoDir = buildRepoDir(
					String(tempRoot),
					key,
					String(plugin.canonical.origin.alias),
				)
				const repoResult = await fetchGithubRepository({
					destination: repoDir,
					origin: plugin.canonical.origin,
					owner: parsed.value.owner,
					repo: parsed.value.repo,
					spec: source.gh,
				})
				if (!repoResult.ok) {
					return failSync("fetch", repoResult.error)
				}

				const resolved = coerceAbsolutePathDirect(repoResult.value.repoPath)
				if (!resolved) {
					return failSync("fetch", {
						field: "path",
						message: `Invalid repo path: ${repoResult.value.repoPath}`,
						source: "manual",
						type: "validation",
					})
				}
				repoPath = resolved
				repoCache.set(key, repoPath)
			}

			fetched.push({
				canonical: plugin.canonical,
				packagePath: repoPath,
				repoPath,
			})
			continue
		}

		const key = buildRepoKey("git", source.url, undefined)
		let repoPath = repoCache.get(key)
		if (!repoPath) {
			const repoDir = buildRepoDir(
				String(tempRoot),
				key,
				String(plugin.canonical.origin.alias),
			)
			const repoResult = await fetchGitRepository({
				destination: repoDir,
				origin: plugin.canonical.origin,
				remoteUrl: source.url,
				spec: source.url,
			})
			if (!repoResult.ok) {
				return failSync("fetch", repoResult.error)
			}

			const resolved = coerceAbsolutePathDirect(repoResult.value.repoPath)
			if (!resolved) {
				return failSync("fetch", {
					field: "path",
					message: `Invalid repo path: ${repoResult.value.repoPath}`,
					source: "manual",
					type: "validation",
				})
			}
			repoPath = resolved
			repoCache.set(key, repoPath)
		}

		fetched.push({
			canonical: plugin.canonical,
			packagePath: repoPath,
			repoPath,
		})
	}

	return { ok: true, value: fetched }
}

function buildRepoGroups(packages: CanonicalPackage[]): SyncResult<RepoGroup[]> {
	const groups = new Map<string, RepoGroup>()

	for (const pkg of packages) {
		if (pkg.type === "github") {
			const parsed = parseGithubSlug(pkg.gh, pkg.origin)
			if (!parsed.ok) {
				return failSync("fetch", parsed.error)
			}

			const pathResult = normalizeSparsePath(pkg.path, pkg.origin, pkg.gh)
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
			const pathResult = normalizeSparsePath(pkg.path, pkg.origin, pkg.url)
			if (!pathResult.ok) {
				return failSync("fetch", pathResult.error)
			}

			const key = buildRepoKey("git", pkg.url, pkg.ref)
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
		fullCheckout: false,
		key,
		origin: pkg.origin,
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
		fullCheckout: false,
		key,
		origin: pkg.origin,
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

async function detectAndExtractPackages(
	fetched: FetchedPackage[],
): Promise<SyncResult<{ packages: ExtractedPackage[]; warnings: string[] }>> {
	const extracted: ExtractedPackage[] = []
	const warnings: string[] = []

	for (const pkg of fetched) {
		const declaration = toValidatedDeclaration(pkg.canonical)
		const detection = await detectStructure({
			declaration,
			packagePath: pkg.packagePath,
		})
		if (!detection.ok) {
			return failSync("detect", detection.error)
		}

		const selected = await selectDetectedStructure(pkg.canonical, detection.value)
		if (!selected.ok) {
			return failSync("detect", selected.error)
		}

		const skills = await extractSkills({
			canonical: pkg.canonical,
			detection: selected.value,
			packagePath: pkg.packagePath,
		})
		if (!skills.ok) {
			if (
				selected.value.method === "plugin" &&
				skills.error.type === "validation" &&
				skills.error.field === "skills"
			) {
				const alias = String(pkg.canonical.origin.alias)
				warnings.push(`Skipping plugin "${alias}": ${skills.error.message}`)
				continue
			}
			return failSync("extract", skills.error)
		}

		extracted.push({
			canonical: pkg.canonical,
			prefix: String(pkg.canonical.origin.alias),
			skills: skills.value,
		})
	}

	return { ok: true, value: { packages: extracted, warnings } }
}

export async function selectDetectedStructure(
	canonical: CanonicalPackage,
	structures: DetectedStructure[],
): Promise<Result<DetectedStructure, SkError>> {
	if (canonical.type === "claude-plugin") {
		const plugin = structures.find((entry) => entry.method === "plugin")
		if (plugin) {
			return { ok: true, value: plugin }
		}

		return {
			error: {
				field: "structure",
				message:
					"Claude plugins must include .claude-plugin/plugin.json in the plugin source.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const plugin = structures.find((entry) => entry.method === "plugin")
	const manifest = structures.find((entry) => entry.method === "manifest")
	const subdir = structures.find((entry) => entry.method === "subdir")
	const single = structures.find((entry) => entry.method === "single")
	const marketplace = structures.find((entry) => entry.method === "marketplace")

	if (manifest) {
		const manifestInfo = await loadManifestInfo(manifest.manifestPath)
		if (!manifestInfo.ok) {
			return manifestInfo
		}
		if (manifestInfo.value.package) {
			return { ok: true, value: manifest }
		}
	}

	if (plugin) {
		return { ok: true, value: plugin }
	}

	if (subdir) {
		return { ok: true, value: subdir }
	}

	if (single) {
		return { ok: true, value: single }
	}

	if (marketplace) {
		return {
			error: {
				field: "structure",
				message:
					"Marketplace packages cannot be installed as skills. Add a plugin from the marketplace instead.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return {
		error: {
			field: "structure",
			message: `No package structure found for ${canonical.type} package.`,
			source: "manual",
			type: "validation",
		},
		ok: false,
	}
}

async function loadManifestInfo(
	manifestPath: AbsolutePath,
): Promise<Result<ManifestInfo, SkError>> {
	const contents = await readTextFile(manifestPath)
	if (!contents.ok) {
		return { error: contents.error, ok: false }
	}

	const parsed = validateManifest(contents.value, manifestPath)
	if (!parsed.ok) {
		return { error: parsed.error, ok: false }
	}

	return { ok: true, value: parsed.value }
}

function toValidatedDeclaration(pkg: CanonicalPackage): ValidatedDeclaration {
	switch (pkg.type) {
		case "registry":
			return {
				name: pkg.name,
				org: pkg.org,
				type: "registry",
				version: pkg.version,
			}
		case "github":
			return {
				gh: pkg.gh,
				path: pkg.path,
				ref: pkg.ref,
				type: "github",
			}
		case "git":
			return {
				path: pkg.path,
				ref: pkg.ref,
				type: "git",
				url: pkg.url,
			}
		case "local":
			return { path: pkg.absolutePath, type: "local" }
		case "claude-plugin":
			return {
				marketplace: pkg.marketplace,
				plugin: pkg.plugin,
				type: "claude-plugin",
			}
	}
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
			return failSync("install", {
				message: `Skill target already exists and is not managed by sk: ${task.targetName}`,
				target: "skill",
				type: "conflict",
			})
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
