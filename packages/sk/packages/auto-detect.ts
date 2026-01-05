import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	type AbsolutePath,
	coerceAbsolutePath,
	coerceAbsolutePathDirect,
	coerceAlias,
	coerceGithubRef,
	coerceGitUrl,
	type DetectedStructure,
	detectStructure,
	type GitRef,
	MANIFEST_FILENAME,
	MARKETPLACE_FILENAME,
	type ManifestInfo,
	PLUGIN_FILENAME,
	parseMarketplace,
	parsePlugin,
	type Result,
	SKILL_FILENAME,
	type ValidatedDeclaration,
	validateManifest,
} from "@skills-supply/core"
import { readTextFile, removePath } from "@/io/fs"
import {
	fetchGithubRepository,
	fetchGitRepository,
	parseGithubSlug,
} from "@/packages/fetch"
import { normalizeSparsePathCore, sparsePathErrorMessage } from "@/packages/path"
import type { PackageOrigin } from "@/types/context"
import type { SkError, ValidationError } from "@/types/errors"

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
	| {
			type: "local"
			path: string
	  }

export interface MarketplaceDetection {
	name: string
	plugins: string[]
}

export type AutoDetectDetection =
	| { method: "claude-plugin"; pluginName: string }
	| { method: "marketplace"; marketplace: MarketplaceDetection }
	| { method: "plugin-mismatch"; pluginName: string; marketplace: MarketplaceDetection }
	| { method: "plugin"; pluginName: string }
	| { method: "manifest" | "subdir" | "single" }

export type AutoDetectResult = Result<
	{ source: AutoDetectSource; detection: AutoDetectDetection },
	SkError
>

export async function autoDetectPackage(
	input: string,
	options: AutoDetectOptions,
): Promise<AutoDetectResult> {
	const parsed = parseAutoDetectUrl(input)
	if (!parsed.ok) {
		return parsed
	}

	const sparseResult = normalizeSparsePath(options.path)
	if (!sparseResult.ok) {
		return sparseResult
	}

	if (parsed.value.type === "local") {
		const resolvedPath = resolveLocalPath(parsed.value.path)
		if (!resolvedPath) {
			const message = `Invalid local path: ${parsed.value.path}`
			return {
				error: {
					field: "path",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const detectionPath = sparseResult.value
			? path.join(resolvedPath, sparseResult.value)
			: resolvedPath
		const absoluteDetectionPath = coerceAbsolutePathDirect(detectionPath)
		if (!absoluteDetectionPath) {
			const message = `Invalid detection path: ${detectionPath}`
			return {
				error: {
					field: "path",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const declaration = buildDeclaration(
			{ path: resolvedPath, type: "local" },
			options.ref,
		)
		if (!declaration.ok) {
			return declaration
		}

		const detection = await detectStructure({
			declaration: declaration.value,
			packagePath: absoluteDetectionPath,
		})
		if (!detection.ok) {
			return { error: detection.error, ok: false }
		}

		const resolved = await resolveDetection(detection.value, {
			hasSubpath: false,
		})
		if (!resolved.ok) {
			return resolved
		}

		return {
			ok: true,
			value: {
				detection: resolved.value,
				source: { path: resolvedPath, type: "local" },
			},
		}
	}

	const tempRootResult = await createTempRoot()
	if (!tempRootResult.ok) {
		return tempRootResult
	}

	const tempRoot = tempRootResult.value
	try {
		const repoDir = path.join(tempRoot, "repo")
		const fetchResult = await fetchRepo(parsed.value, repoDir, {
			ref: options.ref,
			sparsePath: sparseResult.value,
		})
		if (!fetchResult.ok) {
			return fetchResult
		}

		const detectionPath = sparseResult.value
			? path.join(repoDir, sparseResult.value)
			: repoDir
		const absoluteDetectionPath = coerceAbsolutePathDirect(detectionPath)
		if (!absoluteDetectionPath) {
			const message = `Invalid detection path: ${detectionPath}`
			return {
				error: {
					field: "path",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const declaration = buildDeclaration(parsed.value, options.ref)
		if (!declaration.ok) {
			return declaration
		}

		const detection = await detectStructure({
			declaration: declaration.value,
			packagePath: absoluteDetectionPath,
		})
		if (!detection.ok) {
			return { error: detection.error, ok: false }
		}

		const resolved = await resolveDetection(detection.value, {
			hasSubpath: Boolean(sparseResult.value),
		})
		if (!resolved.ok) {
			return resolved
		}

		return {
			ok: true,
			value: {
				detection: resolved.value,
				source: parsed.value,
			},
		}
	} finally {
		await removePath(tempRoot)
	}
}

export type AutoDetectParseResult = Result<AutoDetectSource, ValidationError>

export function parseAutoDetectUrl(input: string): AutoDetectParseResult {
	const trimmed = input.trim().replace(/\/+$/, "")
	if (!trimmed) {
		const message = "Target is required for auto-detect."
		return {
			error: {
				field: "url",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (
		path.isAbsolute(trimmed) ||
		trimmed.startsWith("./") ||
		trimmed.startsWith("../")
	) {
		const resolved = resolveLocalPath(trimmed)
		if (!resolved) {
			const message = `Invalid local path: ${trimmed}`
			return {
				error: {
					field: "path",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: { path: resolved, type: "local" } }
	}

	const githubRef = coerceGithubRef(trimmed)
	if (githubRef) {
		return { ok: true, value: { slug: githubRef, type: "github" } }
	}

	if (trimmed.startsWith("https://")) {
		try {
			const parsed = new URL(trimmed)
			if (parsed.hostname === "github.com") {
				const slug = parseGithubPath(parsed.pathname)
				if (!slug) {
					const message =
						"GitHub URLs must be in the form https://github.com/owner/repo. " +
						"Extra path segments are not supported; use --tag, --branch, or --rev instead."
					return {
						error: {
							field: "url",
							message,
							source: "manual",
							type: "validation",
						},
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
			const message = `Invalid URL: ${trimmed}`
			return {
				error: {
					field: "url",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
	}

	if (trimmed.startsWith("git@")) {
		const match = /^git@([^:]+):(.+)$/.exec(trimmed)
		if (!match?.[1] || !match[2]) {
			const message = `Invalid git SSH URL: ${trimmed}`
			return {
				error: {
					field: "url",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const host = match[1]
		const repoPath = match[2].replace(/\.git$/, "")
		if (!repoPath) {
			const message = `Invalid git SSH URL: ${trimmed}`
			return {
				error: {
					field: "url",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		if (host === "github.com") {
			const slug = parseGithubPath(`/${repoPath}`)
			if (!slug) {
				const message =
					"GitHub SSH URLs must be in the form git@github.com:owner/repo. " +
					"Extra path segments are not supported; use --tag, --branch, or --rev instead."
				return {
					error: {
						field: "url",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			return { ok: true, value: { slug, type: "github" } }
		}

		return { ok: true, value: { type: "git", url: `git@${host}:${repoPath}` } }
	}

	return {
		error: {
			field: "url",
			message:
				"Unsupported auto-detect target. Use owner/repo, a GitHub URL, git@host:path, https://host/repo.git, or a local path.",
			source: "manual",
			type: "validation",
		},
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

async function createTempRoot(): Promise<Result<AbsolutePath, SkError>> {
	try {
		const prefix = path.join(tmpdir(), "sk-auto-detect-")
		const tempRoot = await mkdtemp(prefix)
		const absoluteTempRoot = coerceAbsolutePathDirect(tempRoot)
		if (!absoluteTempRoot) {
			return {
				error: {
					field: "path",
					message: `Invalid temp directory: ${tempRoot}`,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: absoluteTempRoot }
	} catch (error) {
		const absolutePrefix = coerceAbsolutePathDirect(
			path.join(tmpdir(), "sk-auto-detect-"),
		)
		return {
			error: {
				message: "Unable to create temporary directory.",
				operation: "mkdtemp",
				path:
					absolutePrefix ??
					(path.join(tmpdir(), "sk-auto-detect-") as AbsolutePath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function fetchRepo(
	source: AutoDetectSource,
	destination: string,
	options: { ref?: GitRef; sparsePath?: string },
): Promise<Result<void, SkError>> {
	if (source.type === "local") {
		return { ok: true, value: undefined }
	}

	const originAlias = coerceAlias("auto-detect")
	if (!originAlias) {
		const message = "Internal error: invalid alias."
		return {
			error: {
				field: "alias",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const originPath = coerceAbsolutePathDirect(destination)
	if (!originPath) {
		const message = `Invalid destination path: ${destination}`
		return {
			error: {
				field: "path",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const origin: PackageOrigin = {
		alias: originAlias,
		manifestPath: originPath,
	}

	if (source.type === "github") {
		const parsed = parseGithubSlug(source.slug, origin)
		if (!parsed.ok) {
			return { error: parsed.error, ok: false }
		}
		const fetchResult = await fetchGithubRepository({
			destination,
			origin,
			owner: parsed.value.owner,
			ref: options.ref,
			repo: parsed.value.repo,
			sparsePaths: options.sparsePath ? [options.sparsePath] : undefined,
			spec: source.slug,
		})
		if (!fetchResult.ok) {
			return { error: fetchResult.error, ok: false }
		}

		return { ok: true, value: undefined }
	}

	const fetchResult = await fetchGitRepository({
		destination,
		origin,
		ref: options.ref,
		remoteUrl: source.url,
		sparsePaths: options.sparsePath ? [options.sparsePath] : undefined,
		spec: source.url,
	})
	if (!fetchResult.ok) {
		return { error: fetchResult.error, ok: false }
	}

	return { ok: true, value: undefined }
}

function buildDeclaration(
	source: AutoDetectSource,
	ref: GitRef | undefined,
): Result<ValidatedDeclaration, ValidationError> {
	if (source.type === "github") {
		const gh = coerceGithubRef(source.slug)
		if (!gh) {
			const message = `Invalid GitHub slug: ${source.slug}`
			return {
				error: {
					field: "url",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return {
			ok: true,
			value: {
				gh,
				ref,
				type: "github",
			},
		}
	}

	if (source.type === "local") {
		if (ref) {
			const message = "--tag/--branch/--rev are not valid for local paths."
			return {
				error: {
					field: "ref",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const absolutePath = coerceAbsolutePathDirect(source.path)
		if (!absolutePath) {
			const message = `Invalid local path: ${source.path}`
			return {
				error: {
					field: "path",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		return { ok: true, value: { path: absolutePath, type: "local" } }
	}

	const url = coerceGitUrl(source.url)
	if (!url) {
		const message = `Invalid git URL: ${source.url}`
		return {
			error: {
				field: "url",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			ref,
			type: "git",
			url,
		},
	}
}

export async function resolveDetection(
	structures: DetectedStructure[],
	options: { hasSubpath: boolean },
): Promise<Result<AutoDetectDetection, SkError>> {
	const plugin = structures.find((entry) => entry.method === "plugin")
	const marketplace = structures.find((entry) => entry.method === "marketplace")
	const manifest = structures.find((entry) => entry.method === "manifest")
	const subdir = structures.find((entry) => entry.method === "subdir")
	const single = structures.find((entry) => entry.method === "single")

	if (manifest) {
		const manifestInfo = await loadManifestInfo(manifest.manifestPath)
		if (!manifestInfo.ok) {
			return manifestInfo
		}
		if (manifestInfo.value.package) {
			return { ok: true, value: { method: "manifest" } }
		}
	}

	if (plugin && marketplace) {
		if (options.hasSubpath) {
			const message =
				"Marketplaces must live at repo root for remote packages. Remove --path and try again."
			return {
				error: {
					field: "path",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const pluginName = await loadPluginName(plugin.pluginJsonPath)
		if (!pluginName.ok) {
			return pluginName
		}

		const marketplaceInfo = await loadMarketplaceManifest(
			marketplace.marketplaceJsonPath,
		)
		if (!marketplaceInfo.ok) {
			return marketplaceInfo
		}

		if (marketplaceInfo.value.plugins.includes(pluginName.value)) {
			return {
				ok: true,
				value: { method: "claude-plugin", pluginName: pluginName.value },
			}
		}

		return {
			ok: true,
			value: {
				marketplace: marketplaceInfo.value,
				method: "plugin-mismatch",
				pluginName: pluginName.value,
			},
		}
	}

	if (marketplace) {
		if (options.hasSubpath) {
			const message =
				"Marketplaces must live at repo root for remote packages. Remove --path and try again."
			return {
				error: {
					field: "path",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const marketplaceInfo = await loadMarketplaceManifest(
			marketplace.marketplaceJsonPath,
		)
		if (!marketplaceInfo.ok) {
			return marketplaceInfo
		}

		return {
			ok: true,
			value: {
				marketplace: marketplaceInfo.value,
				method: "marketplace",
			},
		}
	}

	if (plugin) {
		const pluginName = await loadPluginName(plugin.pluginJsonPath)
		if (!pluginName.ok) {
			return pluginName
		}

		return { ok: true, value: { method: "plugin", pluginName: pluginName.value } }
	}

	if (subdir) {
		return { ok: true, value: { method: "subdir" } }
	}

	if (single) {
		return { ok: true, value: { method: "single" } }
	}

	return {
		error: {
			field: "structure",
			message: `No ${MANIFEST_FILENAME}, ${MARKETPLACE_FILENAME}, ${PLUGIN_FILENAME}, or ${SKILL_FILENAME} found in package.`,
			source: "manual",
			type: "validation",
		},
		ok: false,
	}
}

async function loadMarketplaceManifest(
	marketplaceJsonPath: AbsolutePath,
): Promise<Result<MarketplaceDetection, SkError>> {
	const contents = await readTextFile(marketplaceJsonPath)
	if (!contents.ok) {
		return { error: contents.error, ok: false }
	}

	const parsed = parseMarketplace(contents.value)
	if (!parsed.ok) {
		return {
			error: {
				...parsed.error,
				path: marketplaceJsonPath,
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			name: parsed.value.name,
			plugins: parsed.value.plugins.map((plugin) => plugin.name),
		},
	}
}

async function loadPluginName(
	pluginJsonPath: AbsolutePath,
): Promise<Result<string, SkError>> {
	const contents = await readTextFile(pluginJsonPath)
	if (!contents.ok) {
		return { error: contents.error, ok: false }
	}

	const parsed = parsePlugin(contents.value)
	if (!parsed.ok) {
		return {
			error: {
				...parsed.error,
				path: pluginJsonPath,
			},
			ok: false,
		}
	}

	return { ok: true, value: parsed.value.name }
}

function normalizeSparsePath(
	pathValue?: string,
): Result<string | undefined, ValidationError> {
	if (!pathValue) {
		return { ok: true, value: undefined }
	}

	const result = normalizeSparsePathCore(pathValue)
	if (!result.ok) {
		const message = sparsePathErrorMessage(result.reason)
		return {
			error: {
				field: "path",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: result.value }
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

function resolveLocalPath(value: string): string | null {
	if (!value.trim()) {
		return null
	}

	if (path.isAbsolute(value)) {
		return path.normalize(value)
	}

	const resolved = coerceAbsolutePath(value, process.cwd())
	return resolved ?? null
}
