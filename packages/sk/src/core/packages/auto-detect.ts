import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readTextFile, removePath } from "@/src/core/io/fs"
import { parseMarketplaceJson } from "@/src/core/marketplace/parse"
import { detectPackageContents } from "@/src/core/packages/detect"
import { fetchGithubRepository, fetchGitRepository } from "@/src/core/packages/fetch"
import { normalizeSparsePathCore, sparsePathErrorMessage } from "@/src/core/packages/path"
import type { DetectionMethod } from "@/src/core/packages/types"
import type { GitRef, PackageOrigin } from "@/src/core/types/branded"
import { coerceAbsolutePathDirect, coerceAlias } from "@/src/core/types/coerce"

export interface AutoDetectOptions {
	path?: string
	ref?: GitRef
}

export type AutoDetectSource =
	| {
			type: "github"
			slug: string
	  }
	| {
			type: "git"
			url: string
	  }

export interface MarketplaceDetection {
	name: string
	plugins: string[]
}

export type AutoDetectDetection =
	| { method: Exclude<DetectionMethod, "marketplace"> }
	| { method: "marketplace"; marketplace: MarketplaceDetection }

export type AutoDetectResult =
	| {
			ok: true
			source: AutoDetectSource
			detection: AutoDetectDetection
	  }
	| {
			ok: false
			error: string
	  }

export async function autoDetectPackage(
	input: string,
	options: AutoDetectOptions,
): Promise<AutoDetectResult> {
	const parsed = parseAutoDetectUrl(input)
	if (!parsed.ok) {
		return parsed
	}

	const tempRootResult = await createTempRoot()
	if (!tempRootResult.ok) {
		return { error: tempRootResult.error, ok: false }
	}

	const tempRoot = tempRootResult.value
	try {
		const repoDir = path.join(tempRoot, "repo")
		const sparseResult = normalizeSparsePath(options.path)
		if (!sparseResult.ok) {
			return { error: sparseResult.error, ok: false }
		}

		const fetchResult = await fetchRepo(parsed.value, repoDir, {
			ref: options.ref,
			sparsePath: sparseResult.value,
		})
		if (!fetchResult.ok) {
			return { error: fetchResult.error, ok: false }
		}

		const detectionPath = sparseResult.value
			? path.join(repoDir, sparseResult.value)
			: repoDir
		const absoluteDetectionPath = coerceAbsolutePathDirect(detectionPath)
		if (!absoluteDetectionPath) {
			return { error: `Invalid detection path: ${detectionPath}`, ok: false }
		}

		const detection = await detectPackageContents(absoluteDetectionPath)
		if (!detection.ok) {
			return { error: detection.error.message, ok: false }
		}

		if (detection.value.method === "marketplace") {
			const marketplace = await loadMarketplaceManifest(absoluteDetectionPath)
			if (!marketplace.ok) {
				return { error: marketplace.error, ok: false }
			}

			return {
				detection: {
					marketplace: marketplace.value,
					method: "marketplace",
				},
				ok: true,
				source: parsed.value,
			}
		}

		return {
			detection: { method: detection.value.method },
			ok: true,
			source: parsed.value,
		}
	} finally {
		await removePath(tempRoot)
	}
}

export type AutoDetectParseResult =
	| { ok: true; value: AutoDetectSource }
	| { ok: false; error: string }

export function parseAutoDetectUrl(input: string): AutoDetectParseResult {
	const trimmed = input.trim().replace(/\/+$/, "")
	if (!trimmed) {
		return { error: "URL is required for auto-detect.", ok: false }
	}

	if (trimmed.startsWith("https://")) {
		try {
			const parsed = new URL(trimmed)
			if (parsed.hostname === "github.com") {
				const slug = parseGithubPath(parsed.pathname)
				if (!slug) {
					return {
						error:
							"GitHub URLs must be in the form https://github.com/owner/repo. " +
							"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
						ok: false,
					}
				}
				return { ok: true, value: { slug, type: "github" } }
			}

			if (parsed.pathname.endsWith(".git")) {
				const cleaned = trimmed.replace(/\.git$/, "")
				return { ok: true, value: { type: "git", url: cleaned } }
			}
		} catch {
			return { error: `Invalid URL: ${trimmed}`, ok: false }
		}
	}

	if (trimmed.startsWith("git@")) {
		const match = /^git@([^:]+):(.+)$/.exec(trimmed)
		if (!match?.[1] || !match[2]) {
			return { error: `Invalid git SSH URL: ${trimmed}`, ok: false }
		}

		const host = match[1]
		const repoPath = match[2].replace(/\.git$/, "")
		if (!repoPath) {
			return { error: `Invalid git SSH URL: ${trimmed}`, ok: false }
		}

		if (host === "github.com") {
			const slug = parseGithubPath(`/${repoPath}`)
			if (!slug) {
				return {
					error:
						"GitHub SSH URLs must be in the form git@github.com:owner/repo. " +
						"Extra path segments are not supported; use --tag, --branch, or --rev instead.",
					ok: false,
				}
			}
			return { ok: true, value: { slug, type: "github" } }
		}

		return { ok: true, value: { type: "git", url: `git@${host}:${repoPath}` } }
	}

	return {
		error: "Unsupported URL format. Use a GitHub URL, git@host:path, or https://host/repo.git.",
		ok: false,
	}
}

function parseGithubPath(pathname: string): string | null {
	const parts = pathname.split("/").filter(Boolean)
	if (parts.length !== 2) {
		return null
	}

	const owner = parts[0]
	const repoRaw = parts[1]
	if (!owner || !repoRaw) {
		return null
	}

	const repo = repoRaw.replace(/\.git$/, "").trim()
	if (!owner || !repo) {
		return null
	}

	return `${owner}/${repo}`
}

async function createTempRoot(): Promise<
	{ ok: true; value: string } | { ok: false; error: string }
> {
	try {
		const prefix = path.join(tmpdir(), "sk-auto-detect-")
		const tempRoot = await mkdtemp(prefix)
		return { ok: true, value: tempRoot }
	} catch (error) {
		return {
			error:
				error instanceof Error
					? `Unable to create temporary directory. ${error.message}`
					: "Unable to create temporary directory.",
			ok: false,
		}
	}
}

async function fetchRepo(
	source: AutoDetectSource,
	destination: string,
	options: { ref?: GitRef; sparsePath?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
	const originAlias = coerceAlias("auto-detect")
	if (!originAlias) {
		return { error: "Internal error: invalid alias.", ok: false }
	}

	const originPath = coerceAbsolutePathDirect(destination)
	if (!originPath) {
		return { error: `Invalid destination path: ${destination}`, ok: false }
	}

	const origin: PackageOrigin = {
		alias: originAlias,
		manifestPath: originPath,
	}

	if (source.type === "github") {
		const [owner, repo] = source.slug.split("/")
		if (!owner || !repo) {
			return {
				error: `Invalid GitHub repository slug: ${source.slug}`,
				ok: false,
			}
		}

		const result = await fetchGithubRepository({
			destination,
			origin,
			owner,
			ref: options.ref,
			repo,
			source: source.slug,
			sparsePaths: options.sparsePath ? [options.sparsePath] : undefined,
		})

		if (!result.ok) {
			return { error: result.error.message, ok: false }
		}

		return { ok: true }
	}

	const result = await fetchGitRepository({
		destination,
		origin,
		ref: options.ref,
		remoteUrl: source.url,
		source: source.url,
		sparsePaths: options.sparsePath ? [options.sparsePath] : undefined,
	})

	if (!result.ok) {
		return { error: result.error.message, ok: false }
	}

	return { ok: true }
}

type SparseResult = { ok: true; value?: string } | { ok: false; error: string }

function normalizeSparsePath(value: string | undefined): SparseResult {
	const result = normalizeSparsePathCore(value)
	if (result.ok) {
		return result
	}

	return { error: sparsePathErrorMessage(result.reason), ok: false }
}

async function loadMarketplaceManifest(
	rootPath: string,
): Promise<{ ok: true; value: MarketplaceDetection } | { ok: false; error: string }> {
	const manifestPath = path.join(rootPath, ".claude-plugin", "marketplace.json")
	const contents = await readTextFile(manifestPath)
	if (!contents.ok) {
		return { error: contents.error.message, ok: false }
	}

	const parsed = parseMarketplaceJson(contents.value, manifestPath)
	if (!parsed.ok) {
		return { error: parsed.error, ok: false }
	}

	return {
		ok: true,
		value: {
			name: parsed.value.name,
			plugins: parsed.value.plugins.map((plugin) => plugin.name),
		},
	}
}
