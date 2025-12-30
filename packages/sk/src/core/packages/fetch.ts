import { execFile } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type {
	GithubPackage,
	GitPackage,
	GitRef,
	LocalPackage,
	PackageFetchError,
	PackageFetchResult,
} from "@/core/packages/types"
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
	alias: string
	destination: string
	ref?: GitRef
	remoteUrl: string
	source: string
	sparsePaths?: string[]
}

export async function fetchGithubPackage(
	canonical: GithubPackage,
	destination: string,
): Promise<PackageFetchResult> {
	const alias = canonical.alias
	const source = canonical.gh
	const parsed = parseGithubSlug(source, alias)
	if (!parsed.ok) {
		return parsed
	}

	const sparsePathResult = normalizeSparsePath(canonical.path, alias, source)
	if (!sparsePathResult.ok) {
		return sparsePathResult
	}

	const remoteUrl = `https://github.com/${parsed.value.owner}/${parsed.value.repo}.git`
	const repoResult = await fetchRepository({
		alias,
		destination,
		ref: canonical.ref,
		remoteUrl,
		source,
		sparsePaths: sparsePathResult.value ? [sparsePathResult.value] : undefined,
	})
	if (!repoResult.ok) {
		return repoResult
	}

	const packagePath = sparsePathResult.value
		? joinRepoPath(repoResult.value.repoPath, sparsePathResult.value)
		: repoResult.value.repoPath

	return {
		ok: true,
		value: {
			canonical,
			packagePath,
			repoPath: repoResult.value.repoPath,
		},
	}
}

export async function fetchGitPackage(
	canonical: GitPackage,
	destination: string,
): Promise<PackageFetchResult> {
	const alias = canonical.alias
	const source = canonical.url
	const sparsePathResult = normalizeSparsePath(canonical.path, alias, source)
	if (!sparsePathResult.ok) {
		return sparsePathResult
	}

	const repoResult = await fetchRepository({
		alias,
		destination,
		ref: canonical.ref,
		remoteUrl: canonical.url,
		source,
		sparsePaths: sparsePathResult.value ? [sparsePathResult.value] : undefined,
	})
	if (!repoResult.ok) {
		return repoResult
	}

	const packagePath = sparsePathResult.value
		? joinRepoPath(repoResult.value.repoPath, sparsePathResult.value)
		: repoResult.value.repoPath

	return {
		ok: true,
		value: {
			canonical,
			packagePath,
			repoPath: repoResult.value.repoPath,
		},
	}
}

export async function fetchLocalPackage(
	canonical: LocalPackage,
): Promise<PackageFetchResult> {
	const alias = canonical.alias
	const source = canonical.absolutePath
	const stats = await safeStat(canonical.absolutePath, alias, source)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return failure(
			"invalid_source",
			`Local path does not exist: ${canonical.absolutePath}`,
			alias,
			source,
		)
	}

	if (!stats.value.isDirectory()) {
		return failure(
			"invalid_source",
			`Local path is not a directory: ${canonical.absolutePath}`,
			alias,
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
	alias: string
	destination: string
	ref?: GitRef
	source: string
	sparsePaths?: string[]
	owner: string
	repo: string
}): Promise<RepoResult> {
	const remoteUrl = `https://github.com/${plan.owner}/${plan.repo}.git`
	return fetchRepository({
		alias: plan.alias,
		destination: plan.destination,
		ref: plan.ref,
		remoteUrl,
		source: plan.source,
		sparsePaths: plan.sparsePaths,
	})
}

export async function fetchGitRepository(plan: {
	alias: string
	destination: string
	ref?: GitRef
	remoteUrl: string
	source: string
	sparsePaths?: string[]
}): Promise<RepoResult> {
	return fetchRepository(plan)
}

export function parseGithubSlug(input: string, alias: string): SlugResult {
	const trimmed = input.trim()
	const [owner, repo, ...rest] = trimmed.split("/")
	if (!owner || !repo || rest.length > 0) {
		return failure(
			"invalid_source",
			`GitHub package "${input}" must be in the form owner/repo.`,
			alias,
			input,
		)
	}

	const cleanedRepo = repo.endsWith(".git") ? repo.slice(0, -4) : repo

	return { ok: true, value: { owner, repo: cleanedRepo } }
}

export function normalizeSparsePath(
	value: string | undefined,
	alias: string,
	source: string,
): SparsePathResult {
	if (value === undefined) {
		return { ok: true, value: undefined }
	}

	const trimmed = value.trim()
	if (!trimmed) {
		return failure("invalid_source", "Package path cannot be empty.", alias, source)
	}

	const cleaned = trimmed.replace(/\\/g, "/")
	if (cleaned.startsWith("/")) {
		return failure("invalid_source", "Package path must be relative.", alias, source)
	}

	const segments = cleaned.split("/")
	if (segments.some((segment) => segment === "..")) {
		return failure(
			"invalid_source",
			"Package path must not escape the repository.",
			alias,
			source,
		)
	}

	const normalized = path.posix.normalize(cleaned).replace(/^\.\/+/, "")
	if (!normalized || normalized === ".") {
		return { ok: true, value: undefined }
	}

	return { ok: true, value: normalized }
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
			plan.alias,
			plan.source,
		)
	}

	const parentDir = path.dirname(plan.destination)
	const ensureResult = await ensureDir(parentDir, plan.alias, plan.source)
	if (!ensureResult.ok) {
		return ensureResult
	}

	const destinationStatus = await safeStat(plan.destination, plan.alias, plan.source)
	if (!destinationStatus.ok) {
		return destinationStatus
	}

	if (destinationStatus.value) {
		return failure(
			"invalid_repo",
			`Destination already exists: ${plan.destination}`,
			plan.alias,
			plan.source,
		)
	}

	const cloneResult = await cloneRepository(
		plan.remoteUrl,
		plan.destination,
		plan.sparsePaths,
		plan.alias,
		plan.source,
	)
	if (!cloneResult.ok) {
		return cloneResult
	}

	if (plan.sparsePaths && plan.sparsePaths.length > 0) {
		const sparseResult = await setSparseCheckout(
			plan.destination,
			plan.sparsePaths,
			plan.alias,
			plan.source,
		)
		if (!sparseResult.ok) {
			return sparseResult
		}
	}

	const checkoutResult = await checkoutRef(
		plan.destination,
		plan.ref,
		plan.alias,
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
	alias: string,
	source: string,
): Promise<ActionResult> {
	const cloneArgs = ["clone", "--depth", "1"]
	if (sparsePaths && sparsePaths.length > 0) {
		cloneArgs.push("--filter=blob:none", "--sparse")
	}
	cloneArgs.push(remoteUrl, repoDir)

	return runGit(cloneArgs, alias, source)
}

async function checkoutRef(
	repoDir: string,
	ref: GitRef | undefined,
	alias: string,
	source: string,
): Promise<ActionResult> {
	if (!ref) {
		return { ok: true }
	}

	if ("tag" in ref) {
		return checkoutTag(repoDir, ref.tag, alias, source)
	}

	if ("branch" in ref) {
		return checkoutBranch(repoDir, ref.branch, alias, source)
	}

	return checkoutRev(repoDir, ref.rev, alias, source)
}

async function checkoutTag(
	repoDir: string,
	tag: string,
	alias: string,
	source: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", "tag", tag],
		alias,
		source,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, alias, source)
		if (!fallback.ok) {
			return fallback
		}
	}

	return runGit(["-C", repoDir, "checkout", "--detach", `tags/${tag}`], alias, source)
}

async function checkoutBranch(
	repoDir: string,
	branch: string,
	alias: string,
	source: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", branch],
		alias,
		source,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, alias, source)
		if (!fallback.ok) {
			return fallback
		}
	}

	return runGit(
		["-C", repoDir, "checkout", "-B", branch, `origin/${branch}`],
		alias,
		source,
	)
}

async function checkoutRev(
	repoDir: string,
	rev: string,
	alias: string,
	source: string,
): Promise<ActionResult> {
	const fetchResult = await runGit(
		["-C", repoDir, "fetch", "--depth", "1", "origin", rev],
		alias,
		source,
	)
	if (!fetchResult.ok) {
		const fallback = await deepenFetch(repoDir, alias, source)
		if (!fallback.ok) {
			return fallback
		}
	}

	const checkoutResult = await runGit(
		["-C", repoDir, "checkout", "--detach", rev],
		alias,
		source,
	)
	if (!checkoutResult.ok) {
		const fallback = await deepenFetch(repoDir, alias, source)
		if (!fallback.ok) {
			return checkoutResult
		}

		return runGit(["-C", repoDir, "checkout", "--detach", rev], alias, source)
	}

	return checkoutResult
}

async function deepenFetch(
	repoDir: string,
	alias: string,
	source: string,
): Promise<ActionResult> {
	return runGit(["-C", repoDir, "fetch", "--depth", "50", "origin"], alias, source)
}

async function setSparseCheckout(
	repoDir: string,
	sparsePaths: string[],
	alias: string,
	source: string,
): Promise<ActionResult> {
	const initResult = await runGit(
		["-C", repoDir, "sparse-checkout", "init", "--cone"],
		alias,
		source,
	)
	if (!initResult.ok) {
		return initResult
	}

	return runGit(
		["-C", repoDir, "sparse-checkout", "set", ...sparsePaths],
		alias,
		source,
	)
}

async function ensureDir(
	target: string,
	alias: string,
	source: string,
): Promise<ActionResult> {
	try {
		await mkdir(target, { recursive: true })
		return { ok: true }
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to create directory ${target}.`),
			alias,
			source,
		)
	}
}

async function safeStat(
	target: string,
	alias: string,
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
			alias,
			source,
		)
	}
}

async function runGit(
	args: string[],
	alias: string,
	source: string,
): Promise<ActionResult> {
	try {
		await execFileAsync("git", args, { encoding: "utf8" })
		return { ok: true }
	} catch (error) {
		return failure(
			"git_error",
			formatErrorMessage(error, `git ${args.join(" ")} failed.`),
			alias,
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
	alias: string,
	source: string,
): { ok: false; error: PackageFetchError } {
	return {
		error: {
			alias,
			message,
			source,
			type,
		},
		ok: false,
	}
}
