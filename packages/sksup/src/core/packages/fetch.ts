import { execFile } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
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
const CACHE_ROOT = path.join(homedir(), ".cache", "sksup", "repos")

type ActionResult = { ok: true } | { ok: false; error: PackageFetchError }

type SlugResult =
	| { ok: true; value: { owner: string; repo: string } }
	| { ok: false; error: PackageFetchError }

export async function fetchGithubPackage(
	canonical: GithubPackage,
): Promise<PackageFetchResult> {
	const alias = canonical.alias
	const source = canonical.gh
	const parsed = parseGithubSlug(canonical.gh, alias)
	if (!parsed.ok) {
		return parsed
	}

	try {
		ensureGitAvailable()
	} catch (error) {
		return failure(
			"git_error",
			formatErrorMessage(error, "git is required to fetch packages."),
			alias,
			source,
		)
	}

	const repoDir = path.join(
		CACHE_ROOT,
		"github.com",
		parsed.value.owner,
		parsed.value.repo,
	)
	const repoParent = path.dirname(repoDir)
	const remoteUrl = `https://github.com/${parsed.value.owner}/${parsed.value.repo}.git`

	const syncResult = await syncRepository(
		remoteUrl,
		repoDir,
		repoParent,
		canonical.ref,
		alias,
		source,
	)
	if (!syncResult.ok) {
		return syncResult
	}

	const packagePath = canonical.path ? path.join(repoDir, canonical.path) : repoDir

	return {
		ok: true,
		value: {
			canonical,
			packagePath,
			repoPath: repoDir,
		},
	}
}

export async function fetchGitPackage(
	canonical: GitPackage,
): Promise<PackageFetchResult> {
	const alias = canonical.alias
	const source = canonical.url
	const repoDirResult = buildCachePathFromUrl(canonical.normalizedUrl, alias, source)
	if (!repoDirResult.ok) {
		return repoDirResult
	}

	try {
		ensureGitAvailable()
	} catch (error) {
		return failure(
			"git_error",
			formatErrorMessage(error, "git is required to fetch packages."),
			alias,
			source,
		)
	}

	const repoDir = repoDirResult.value
	const repoParent = path.dirname(repoDir)
	const syncResult = await syncRepository(
		canonical.url,
		repoDir,
		repoParent,
		canonical.ref,
		alias,
		source,
	)
	if (!syncResult.ok) {
		return syncResult
	}

	const packagePath = canonical.path ? path.join(repoDir, canonical.path) : repoDir

	return {
		ok: true,
		value: {
			canonical,
			packagePath,
			repoPath: repoDir,
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

async function syncRepository(
	remoteUrl: string,
	repoDir: string,
	repoParent: string,
	ref: GitRef | undefined,
	alias: string,
	source: string,
): Promise<ActionResult> {
	const ensureDirResult = await ensureDir(repoParent, alias, source)
	if (!ensureDirResult.ok) {
		return ensureDirResult
	}

	const repoStatus = await getRepoStatus(repoDir, alias, source)
	if (!repoStatus.ok) {
		return repoStatus
	}

	if (repoStatus.value === "missing") {
		const cloneResult = await runGit(["clone", remoteUrl, repoDir], alias, source)
		if (!cloneResult.ok) {
			return cloneResult
		}
	} else {
		const fetchResult = await runGit(
			["-C", repoDir, "fetch", "--prune", "--tags", "origin"],
			alias,
			source,
		)
		if (!fetchResult.ok) {
			return fetchResult
		}
	}

	return checkoutRef(repoDir, ref, alias, source)
}

function buildCachePathFromUrl(
	normalizedUrl: string,
	alias: string,
	source: string,
): { ok: true; value: string } | { ok: false; error: PackageFetchError } {
	try {
		const parsed = new URL(normalizedUrl)
		const host = parsed.hostname.toLowerCase()
		const repoPath = parsed.pathname.replace(/^\/+/, "").replace(/\/$/, "")
		if (!repoPath) {
			return failure(
				"invalid_source",
				"Git URL must include a repository path.",
				alias,
				source,
			)
		}

		return { ok: true, value: path.join(CACHE_ROOT, host, repoPath) }
	} catch (error) {
		return failure(
			"invalid_source",
			formatErrorMessage(error, "Git URL is invalid."),
			alias,
			source,
		)
	}
}

async function checkoutRef(
	repoDir: string,
	ref: GitRef | undefined,
	alias: string,
	source: string,
): Promise<ActionResult> {
	if (!ref) {
		const defaultBranch = await resolveDefaultBranch(repoDir, alias, source)
		if (!defaultBranch.ok) {
			return defaultBranch
		}

		const checkoutDefault = await checkoutBranch(
			repoDir,
			defaultBranch.value,
			alias,
			source,
		)
		if (!checkoutDefault.ok) {
			return checkoutDefault
		}

		return { ok: true }
	}

	if ("tag" in ref) {
		return runGit(
			["-C", repoDir, "checkout", "--detach", `tags/${ref.tag}`],
			alias,
			source,
		)
	}

	if ("branch" in ref) {
		return checkoutBranch(repoDir, ref.branch, alias, source)
	}

	return runGit(["-C", repoDir, "checkout", "--detach", ref.rev], alias, source)
}

async function checkoutBranch(
	repoDir: string,
	branch: string,
	alias: string,
	source: string,
): Promise<ActionResult> {
	const checkout = await runGit(["-C", repoDir, "checkout", branch], alias, source)
	if (!checkout.ok) {
		const track = await runGit(
			["-C", repoDir, "checkout", "-B", branch, `origin/${branch}`],
			alias,
			source,
		)
		if (!track.ok) {
			return track
		}
	}

	return runGit(["-C", repoDir, "reset", "--hard", `origin/${branch}`], alias, source)
}

async function resolveDefaultBranch(
	repoDir: string,
	alias: string,
	source: string,
): Promise<{ ok: true; value: string } | { ok: false; error: PackageFetchError }> {
	const symbolic = await tryGit([
		"-C",
		repoDir,
		"symbolic-ref",
		"--quiet",
		"refs/remotes/origin/HEAD",
	])
	if (symbolic) {
		const ref = symbolic.trim()
		const match = /refs\/remotes\/origin\/(.+)$/.exec(ref)
		if (match?.[1]) {
			return { ok: true, value: match[1] }
		}
	}

	const remoteShow = await tryGit(["-C", repoDir, "remote", "show", "origin"])
	if (remoteShow) {
		const line = remoteShow
			.split("\n")
			.map((entry) => entry.trim())
			.find((entry) => entry.startsWith("HEAD branch:"))
		if (line) {
			const branch = line.replace("HEAD branch:", "").trim()
			if (branch) {
				return { ok: true, value: branch }
			}
		}
	}

	return failure(
		"invalid_ref",
		"Unable to determine default branch for repository.",
		alias,
		source,
	)
}

function parseGithubSlug(input: string, alias: string): SlugResult {
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

async function getRepoStatus(
	repoDir: string,
	alias: string,
	source: string,
): Promise<
	{ ok: true; value: "missing" | "ready" } | { ok: false; error: PackageFetchError }
> {
	const stats = await safeStat(repoDir, alias, source)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: "missing" }
	}

	if (!stats.value.isDirectory()) {
		return failure(
			"invalid_repo",
			`Repository path is not a directory: ${repoDir}`,
			alias,
			source,
		)
	}

	const gitDir = await safeStat(path.join(repoDir, ".git"), alias, source)
	if (!gitDir.ok) {
		return gitDir
	}

	if (!gitDir.value || !gitDir.value.isDirectory()) {
		return failure(
			"invalid_repo",
			`Repository at ${repoDir} is not a git checkout.`,
			alias,
			source,
		)
	}

	return { ok: true, value: "ready" }
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

async function tryGit(args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", args, { encoding: "utf8" })
		return stdout
	} catch {
		return null
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
