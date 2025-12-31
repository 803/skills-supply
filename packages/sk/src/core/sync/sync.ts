import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
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
import type { Manifest, MergedManifest } from "@/core/manifest/types"
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
import { resolveMergedPackages } from "@/core/packages/resolve"
import type {
	CanonicalPackage,
	FetchedPackage,
	GithubPackage,
	GitPackage,
	GitRef,
	PackageOrigin,
} from "@/core/packages/types"
import { failSync } from "@/core/sync/errors"
import { resolveAgentPackages } from "@/core/sync/marketplace"
import { buildRepoDir, buildRepoKey } from "@/core/sync/repo"
import type {
	ExtractedPackage,
	SyncOptions,
	SyncResult,
	SyncSummary,
} from "@/core/sync/types"
import { validateExtractedPackages } from "@/core/sync/validate"
import type { AbsolutePath } from "@/core/types/branded"
import { coerceAbsolutePathDirect } from "@/core/types/coerce"

interface AgentSyncSummary {
	agent: AgentDefinition
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
	const manifestResult = await loadManifests(process.cwd())
	if (!manifestResult.ok) {
		return manifestResult
	}

	const mergedResult = mergeManifests(manifestResult.value)
	if (!mergedResult.ok) {
		return failSync("merge", mergedResult.error)
	}

	const packages = resolveMergedPackages(mergedResult.value)

	const agentsResult = await resolveAgents(mergedResult.value)
	if (!agentsResult.ok) {
		return agentsResult
	}

	const warnings: string[] = [...mergedResult.value.warnings]
	let installed = 0
	let removed = 0

	for (const agent of agentsResult.value) {
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
			agents: agentsResult.value.map((agent) => agent.displayName),
			dependencies: packages.length,
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

		// Determine discoveredAt based on path
		const discoveredAt = manifestPath.includes("/.sk/")
			? "sk-global"
			: manifestPath.startsWith(startDir)
				? "cwd"
				: "parent"

		const parsed = parseManifest(contents.value, manifestPath, discoveredAt)
		if (!parsed.ok) {
			return failSync("parse", parsed.error)
		}

		manifests.push(parsed.value)
	}

	return { ok: true, value: manifests }
}

async function resolveAgents(
	merged: MergedManifest,
): Promise<SyncResult<AgentDefinition[]>> {
	if (merged.agents.size > 0) {
		const agents: AgentDefinition[] = []
		for (const [agentId, enabled] of merged.agents) {
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

async function createTempRoot(agentId: string): Promise<SyncResult<string>> {
	try {
		const prefix = path.join(tmpdir(), `sk-${agentId}-`)
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
						source: group.source,
						sparsePaths,
					})
				: await fetchGitRepository({
						destination: repoDir,
						origin: group.origin,
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
				packagePath: coerceAbsolutePathDirect(packagePath)!,
				repoPath: coerceAbsolutePathDirect(repoResult.value.repoPath)!,
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
): Promise<SyncResult<ExtractedPackage[]>> {
	const extracted: ExtractedPackage[] = []

	for (const pkg of fetched) {
		const detection = await detectPackageType(pkg.canonical, pkg.packagePath)
		if (!detection.ok) {
			return failSync("detect", detection.error)
		}

		const skills = await extractSkills(detection.value)
		if (!skills.ok) {
			return failSync("extract", skills.error)
		}

		extracted.push({
			canonical: pkg.canonical,
			prefix: String(pkg.canonical.origin.alias),
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
					`Skill target already exists and is not managed by sk: ${task.targetName}`,
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
