import { execFile } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { AbsolutePath, GitRef } from "@skills-supply/core"
import { normalizeSparsePathCore, sparsePathErrorMessage } from "@/packages/path"
import type {
	LocalPackage,
	PackageFetchError,
	PackageFetchResult,
} from "@/packages/types"
import type { PackageOrigin } from "@/types/context"
import { ensureGitAvailable } from "@/utils/git"

const execFileAsync = promisify(execFile)

type ActionResult = { ok: true } | { ok: false; error: PackageFetchError }

type RepoResult =
	| { ok: true; value: { repoPath: string } }
	| { ok: false; error: PackageFetchError }

type SlugResult =
	| { ok: true; value: { owner: string; repo: string } }
	| { ok: false; error: PackageFetchError }

type SparsePathResult =
	| { ok: true; value?: string }
	| { ok: false; error: PackageFetchError }

interface RepoFetchPlan {
	origin: PackageOrigin
	destination: string
	ref?: GitRef
	remoteUrl: string
	spec: string
	sparsePaths?: string[]
}

export async function fetchLocalPackage(
	canonical: LocalPackage,
): Promise<PackageFetchResult> {
	const origin = canonical.origin
	const spec = canonical.absolutePath
	const stats = await safeStat(canonical.absolutePath, origin, spec)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		const message = `Local path does not exist: ${canonical.absolutePath}`
		return {
			error: {
				field: "source",
				message,
				origin,
				path: canonical.absolutePath,
				source: "manual",
				spec,
				type: "validation",
			},
			ok: false,
		}
	}

	if (!stats.value.isDirectory()) {
		const message = `Local path is not a directory: ${canonical.absolutePath}`
		return {
			error: {
				field: "source",
				message,
				origin,
				path: canonical.absolutePath,
				source: "manual",
				spec,
				type: "validation",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			canonical,
			packagePath: canonical.absolutePath,
			repoPath: canonical.absolutePath,
		},
	}
}

export async function fetchGithubRepository(plan: {
	origin: PackageOrigin
	destination: string
	ref?: GitRef
	spec: string
	sparsePaths?: string[]
	owner: string
	repo: string
}): Promise<RepoResult> {
	const remoteUrl = `https://github.com/${plan.owner}/${plan.repo}.git`
	return fetchRepository({
		destination: plan.destination,
		origin: plan.origin,
		ref: plan.ref,
		remoteUrl,
		sparsePaths: plan.sparsePaths,
		spec: plan.spec,
	})
}

export async function fetchGitRepository(plan: {
	origin: PackageOrigin
	destination: string
	ref?: GitRef
	remoteUrl: string
	spec: string
	sparsePaths?: string[]
}): Promise<RepoResult> {
	return fetchRepository(plan)
}

export function parseGithubSlug(input: string, origin: PackageOrigin): SlugResult {
	const trimmed = input.trim()
	const [owner, repo, ...rest] = trimmed.split("/")
	if (!owner || !repo || rest.length > 0) {
		const message = `GitHub package "${input}" must be in the form owner/repo.`
		return {
			error: {
				field: "source",
				message,
				origin,
				source: "manual",
				spec: input,
				type: "validation",
			},
			ok: false,
		}
	}

	const cleanedRepo = repo.endsWith(".git") ? repo.slice(0, -4) : repo

	return { ok: true, value: { owner, repo: cleanedRepo } }
}

export function normalizeSparsePath(
	value: string | undefined,
	origin: PackageOrigin,
	spec: string,
): SparsePathResult {
	const result = normalizeSparsePathCore(value)
	if (result.ok) {
		return result
	}

	return {
		error: {
			field: "path",
			message: sparsePathErrorMessage(result.reason),
			origin,
			source: "manual",
			spec,
			type: "validation",
		},
		ok: false,
	}
}

export function joinRepoPath(repoDir: string, sparsePath: string): string {
	return path.join(repoDir, ...sparsePath.split("/"))
}

async function fetchRepository(plan: RepoFetchPlan): Promise<RepoResult> {
	const destinationPath = toAbsolutePath(plan.destination)
	const gitCheck = ensureGitAvailable()
	if (!gitCheck.ok) {
		return {
			error: {
				...gitCheck.error,
				origin: plan.origin,
				path: destinationPath,
				spec: plan.spec,
			},
			ok: false,
		}
	}

	const parentDir = path.dirname(destinationPath)
	const ensureResult = await ensureDir(parentDir, plan.origin, plan.spec)
	if (!ensureResult.ok) {
		return ensureResult
	}

	const destinationStatus = await safeStat(destinationPath, plan.origin, plan.spec)
	if (!destinationStatus.ok) {
		return destinationStatus
	}

	if (destinationStatus.value) {
		return {
			error: {
				message: `Destination already exists: ${plan.destination}`,
				origin: plan.origin,
				path: destinationPath,
				spec: plan.spec,
				target: "destination",
				type: "conflict",
			},
			ok: false,
		}
	}

	const cloneResult = await cloneRepository(
		plan.remoteUrl,
		plan.destination,
		plan.sparsePaths,
		plan.origin,
		plan.spec,
	)
	if (!cloneResult.ok) {
		return cloneResult
	}

	if (plan.sparsePaths && plan.sparsePaths.length > 0) {
		const sparseResult = await setSparseCheckout(
			plan.destination,
			plan.sparsePaths,
			plan.origin,
			plan.spec,
		)
		if (!sparseResult.ok) {
			return sparseResult
		}
	}

	const checkoutResult = await checkoutRef(
		plan.destination,
		plan.ref,
		plan.origin,
		plan.spec,
	)
	if (!checkoutResult.ok) {
		return checkoutResult
	}

	return { ok: true, value: { repoPath: plan.destination } }
}

async function cloneRepository(
	remoteUrl: string,
	repoDir: string,
	sparsePaths: string[] | undefined,
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	const cloneArgs = ["clone", "--depth", "1"]
	if (sparsePaths && sparsePaths.length > 0) {
		cloneArgs.push("--filter=blob:none", "--sparse")
	}
	cloneArgs.push(remoteUrl, repoDir)

	return runGit(cloneArgs, origin, spec)
}

async function checkoutRef(
	repoDir: string,
	ref: GitRef | undefined,
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	if (!ref) {
		return { ok: true }
	}

	switch (ref.type) {
		case "tag":
			return checkoutTag(repoDir, ref.value, origin, spec)
		case "branch":
			return checkoutBranch(repoDir, ref.value, origin, spec)
		case "rev":
			return checkoutRev(repoDir, ref.value, origin, spec)
	}
}

async function checkoutTag(
	repoDir: string,
	tag: string,
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", "tag", tag],
		origin,
		spec,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, spec)
		if (!fallback.ok) {
			return fallback
		}
	}

	return runGit(["-C", repoDir, "checkout", "--detach", `tags/${tag}`], origin, spec)
}

async function checkoutBranch(
	repoDir: string,
	branch: string,
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", branch],
		origin,
		spec,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, spec)
		if (!fallback.ok) {
			return fallback
		}
	}

	return runGit(
		["-C", repoDir, "checkout", "-B", branch, `origin/${branch}`],
		origin,
		spec,
	)
}

async function checkoutRev(
	repoDir: string,
	rev: string,
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", rev],
		origin,
		spec,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, spec)
		if (!fallback.ok) {
			return fallback
		}
	}

	const checkoutResult = await runGit(
		["-C", repoDir, "checkout", "--detach", rev],
		origin,
		spec,
	)
	if (!checkoutResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, spec)
		if (!fallback.ok) {
			return checkoutResult
		}

		return runGit(["-C", repoDir, "checkout", "--detach", rev], origin, spec)
	}

	return checkoutResult
}

async function deepenFetch(
	repoDir: string,
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	return runGit(["-C", repoDir, "fetch", "--depth", "50", "origin"], origin, spec)
}

async function setSparseCheckout(
	repoDir: string,
	sparsePaths: string[],
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	const initResult = await runGit(
		["-C", repoDir, "sparse-checkout", "init", "--cone"],
		origin,
		spec,
	)
	if (!initResult.ok) {
		return initResult
	}

	return runGit(["-C", repoDir, "sparse-checkout", "set", ...sparsePaths], origin, spec)
}

async function ensureDir(
	target: string,
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	try {
		await mkdir(target, { recursive: true })
		return { ok: true }
	} catch (error) {
		return {
			error: {
				message: `Unable to create directory ${target}.`,
				operation: "mkdir",
				origin,
				path: toAbsolutePath(target),
				rawError: error instanceof Error ? error : undefined,
				spec,
				type: "io",
			},
			ok: false,
		}
	}
}

async function safeStat(
	target: string,
	origin: PackageOrigin,
	spec: string,
): Promise<
	| { ok: true; value: Awaited<ReturnType<typeof stat>> | null }
	| { ok: false; error: PackageFetchError }
> {
	try {
		const stats = await stat(target)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return {
			error: {
				message: `Unable to access ${target}.`,
				operation: "stat",
				origin,
				path: toAbsolutePath(target),
				rawError: error instanceof Error ? error : undefined,
				spec,
				type: "io",
			},
			ok: false,
		}
	}
}

async function runGit(
	args: string[],
	origin: PackageOrigin,
	spec: string,
): Promise<ActionResult> {
	try {
		await execFileAsync("git", args, { encoding: "utf8" })
		return { ok: true }
	} catch (error) {
		const cwdIndex = args.indexOf("-C")
		const repoDir =
			cwdIndex >= 0 && args[cwdIndex + 1] ? args[cwdIndex + 1] : undefined
		return {
			error: {
				message: `git ${args.join(" ")} failed.`,
				operation: "git",
				origin,
				path: repoDir ? toAbsolutePath(repoDir) : origin.manifestPath,
				rawError: error instanceof Error ? error : undefined,
				spec,
				type: "io",
			},
			ok: false,
		}
	}
}

function toAbsolutePath(value: string): AbsolutePath {
	const resolved = path.isAbsolute(value) ? path.normalize(value) : path.resolve(value)
	return resolved as AbsolutePath
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}
