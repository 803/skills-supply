import { execFile } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { normalizeSparsePathCore, sparsePathErrorMessage } from "@/src/core/packages/path"
import type {
	GitRef,
	LocalPackage,
	PackageFetchError,
	PackageFetchResult,
} from "@/src/core/packages/types"
import type { PackageOrigin } from "@/src/core/types/branded"
import { ensureGitAvailable } from "@/src/utils/git"

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
	source: string
	sparsePaths?: string[]
}

export async function fetchLocalPackage(
	canonical: LocalPackage,
): Promise<PackageFetchResult> {
	const origin = canonical.origin
	const source = canonical.absolutePath
	const stats = await safeStat(canonical.absolutePath, origin, source)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return failure(
			"invalid_source",
			`Local path does not exist: ${canonical.absolutePath}`,
			origin,
			source,
		)
	}

	if (!stats.value.isDirectory()) {
		return failure(
			"invalid_source",
			`Local path is not a directory: ${canonical.absolutePath}`,
			origin,
			source,
		)
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
	source: string
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
		source: plan.source,
		sparsePaths: plan.sparsePaths,
	})
}

export async function fetchGitRepository(plan: {
	origin: PackageOrigin
	destination: string
	ref?: GitRef
	remoteUrl: string
	source: string
	sparsePaths?: string[]
}): Promise<RepoResult> {
	return fetchRepository(plan)
}

export function parseGithubSlug(input: string, origin: PackageOrigin): SlugResult {
	const trimmed = input.trim()
	const [owner, repo, ...rest] = trimmed.split("/")
	if (!owner || !repo || rest.length > 0) {
		return failure(
			"invalid_source",
			`GitHub package "${input}" must be in the form owner/repo.`,
			origin,
			input,
		)
	}

	const cleanedRepo = repo.endsWith(".git") ? repo.slice(0, -4) : repo

	return { ok: true, value: { owner, repo: cleanedRepo } }
}

export function normalizeSparsePath(
	value: string | undefined,
	origin: PackageOrigin,
	source: string,
): SparsePathResult {
	const result = normalizeSparsePathCore(value)
	if (result.ok) {
		return result
	}

	return failure(
		"invalid_source",
		sparsePathErrorMessage(result.reason),
		origin,
		source,
	)
}

export function joinRepoPath(repoDir: string, sparsePath: string): string {
	return path.join(repoDir, ...sparsePath.split("/"))
}

async function fetchRepository(plan: RepoFetchPlan): Promise<RepoResult> {
	try {
		ensureGitAvailable()
	} catch (error) {
		return failure(
			"git_error",
			formatErrorMessage(error, "git is required to fetch packages."),
			plan.origin,
			plan.source,
		)
	}

	const parentDir = path.dirname(plan.destination)
	const ensureResult = await ensureDir(parentDir, plan.origin, plan.source)
	if (!ensureResult.ok) {
		return ensureResult
	}

	const destinationStatus = await safeStat(plan.destination, plan.origin, plan.source)
	if (!destinationStatus.ok) {
		return destinationStatus
	}

	if (destinationStatus.value) {
		return failure(
			"invalid_repo",
			`Destination already exists: ${plan.destination}`,
			plan.origin,
			plan.source,
		)
	}

	const cloneResult = await cloneRepository(
		plan.remoteUrl,
		plan.destination,
		plan.sparsePaths,
		plan.origin,
		plan.source,
	)
	if (!cloneResult.ok) {
		return cloneResult
	}

	if (plan.sparsePaths && plan.sparsePaths.length > 0) {
		const sparseResult = await setSparseCheckout(
			plan.destination,
			plan.sparsePaths,
			plan.origin,
			plan.source,
		)
		if (!sparseResult.ok) {
			return sparseResult
		}
	}

	const checkoutResult = await checkoutRef(
		plan.destination,
		plan.ref,
		plan.origin,
		plan.source,
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
	source: string,
): Promise<ActionResult> {
	const cloneArgs = ["clone", "--depth", "1"]
	if (sparsePaths && sparsePaths.length > 0) {
		cloneArgs.push("--filter=blob:none", "--sparse")
	}
	cloneArgs.push(remoteUrl, repoDir)

	return runGit(cloneArgs, origin, source)
}

async function checkoutRef(
	repoDir: string,
	ref: GitRef | undefined,
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	if (!ref) {
		return { ok: true }
	}

	switch (ref.type) {
		case "tag":
			return checkoutTag(repoDir, ref.value, origin, source)
		case "branch":
			return checkoutBranch(repoDir, ref.value, origin, source)
		case "rev":
			return checkoutRev(repoDir, ref.value, origin, source)
	}
}

async function checkoutTag(
	repoDir: string,
	tag: string,
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", "tag", tag],
		origin,
		source,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, source)
		if (!fallback.ok) {
			return fallback
		}
	}

	return runGit(["-C", repoDir, "checkout", "--detach", `tags/${tag}`], origin, source)
}

async function checkoutBranch(
	repoDir: string,
	branch: string,
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", branch],
		origin,
		source,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, source)
		if (!fallback.ok) {
			return fallback
		}
	}

	return runGit(
		["-C", repoDir, "checkout", "-B", branch, `origin/${branch}`],
		origin,
		source,
	)
}

async function checkoutRev(
	repoDir: string,
	rev: string,
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", rev],
		origin,
		source,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, source)
		if (!fallback.ok) {
			return fallback
		}
	}

	const checkoutResult = await runGit(
		["-C", repoDir, "checkout", "--detach", rev],
		origin,
		source,
	)
	if (!checkoutResult.ok) {
		const fallback = await deepenFetch(repoDir, origin, source)
		if (!fallback.ok) {
			return checkoutResult
		}

		return runGit(["-C", repoDir, "checkout", "--detach", rev], origin, source)
	}

	return checkoutResult
}

async function deepenFetch(
	repoDir: string,
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	return runGit(["-C", repoDir, "fetch", "--depth", "50", "origin"], origin, source)
}

async function setSparseCheckout(
	repoDir: string,
	sparsePaths: string[],
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	const initResult = await runGit(
		["-C", repoDir, "sparse-checkout", "init", "--cone"],
		origin,
		source,
	)
	if (!initResult.ok) {
		return initResult
	}

	return runGit(
		["-C", repoDir, "sparse-checkout", "set", ...sparsePaths],
		origin,
		source,
	)
}

async function ensureDir(
	target: string,
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	try {
		await mkdir(target, { recursive: true })
		return { ok: true }
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to create directory ${target}.`),
			origin,
			source,
		)
	}
}

async function safeStat(
	target: string,
	origin: PackageOrigin,
	source: string,
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

		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to access ${target}.`),
			origin,
			source,
		)
	}
}

async function runGit(
	args: string[],
	origin: PackageOrigin,
	source: string,
): Promise<ActionResult> {
	try {
		await execFileAsync("git", args, { encoding: "utf8" })
		return { ok: true }
	} catch (error) {
		return failure(
			"git_error",
			formatErrorMessage(error, `git ${args.join(" ")} failed.`),
			origin,
			source,
		)
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

function formatErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return `${fallback} ${error.message}`
	}

	return fallback
}

function failure(
	type: PackageFetchError["type"],
	message: string,
	origin: PackageOrigin,
	source: string,
): { ok: false; error: PackageFetchError } {
	return {
		error: {
			message,
			origin,
			source,
			type,
		},
		ok: false,
	}
}
