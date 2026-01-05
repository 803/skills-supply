import path from "node:path"
import type { AbsolutePath, NonEmptyString } from "@/types/branded"
import { coerceAbsolutePath, coerceGithubRef, coerceGitUrl } from "@/types/coerce"
import type { MarketplaceInfo } from "@/types/content"
import type { ValidatedDeclaration } from "@/types/declaration"
import type { Result } from "@/types/error"

export function resolvePluginSource(
	marketplace: MarketplaceInfo,
	plugin: string,
	basePath: AbsolutePath,
): Result<ValidatedDeclaration> {
	const targetName = plugin.trim()
	if (!targetName) {
		const message = "Plugin name must be non-empty."
		return {
			error: {
				field: "plugin",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const entry = marketplace.plugins.find((item) => item.name === targetName)
	if (!entry) {
		return {
			error: {
				message: `Plugin "${targetName}" not found in marketplace.`,
				target: "plugin",
				type: "not_found",
			},
			ok: false,
		}
	}

	const source = entry.source
	if (typeof source === "string") {
		return resolveStringSource(source, basePath, marketplace.metadata?.pluginRoot)
	}

	if (typeof source !== "object" || source === null || Array.isArray(source)) {
		const message = `Plugin "${targetName}" source must be a string or object declaration.`
		return {
			error: {
				field: "source",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const sourceRecord = source as Record<string, unknown>
	const sourceType =
		typeof sourceRecord.source === "string" ? sourceRecord.source.trim() : ""
	if (!sourceType) {
		const message = `Plugin "${targetName}" source must include a non-empty "source" field.`
		return {
			error: {
				field: "source",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (sourceType === "github") {
		const repoValue = sourceRecord.repo
		if (typeof repoValue !== "string" || !repoValue.trim()) {
			const message = `Plugin "${targetName}" source repo must be a non-empty string.`
			return {
				error: {
					field: "source",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const gh = coerceGithubRef(stripGithubPrefix(repoValue.trim()))
		if (!gh) {
			const message = `Plugin "${targetName}" source repo must be in owner/repo format.`
			return {
				error: {
					field: "source",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		return { ok: true, value: { gh, type: "github" } }
	}

	if (sourceType === "url") {
		const urlValue = sourceRecord.url
		if (typeof urlValue !== "string" || !urlValue.trim()) {
			const message = `Plugin "${targetName}" source url must be a non-empty string.`
			return {
				error: {
					field: "source",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const url = coerceGitUrl(urlValue.trim())
		if (!url) {
			const message = `Plugin "${targetName}" source url must be a valid git URL.`
			return {
				error: {
					field: "source",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		return { ok: true, value: { type: "git", url } }
	}

	return {
		error: {
			field: "source",
			message: `Plugin "${targetName}" source must use "github" or "url" for source type.`,
			source: "manual",
			type: "validation",
		},
		ok: false,
	}
}

function resolveStringSource(
	value: string,
	basePath: AbsolutePath,
	pluginRoot: NonEmptyString | undefined,
): Result<ValidatedDeclaration> {
	const trimmed = value.trim()
	if (!trimmed) {
		const message = "Plugin source must not be empty."
		return {
			error: {
				field: "source",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const baseDir = resolvePluginRoot(basePath, pluginRoot)
	const resolved = coerceAbsolutePath(trimmed, baseDir)
	if (!resolved) {
		const message = "Plugin source path is invalid."
		return {
			error: {
				field: "source",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: { path: resolved, type: "local" } }
}

function resolvePluginRoot(
	rootPath: AbsolutePath,
	pluginRoot: NonEmptyString | undefined,
): AbsolutePath {
	if (!pluginRoot) {
		return rootPath
	}

	const expanded = expandHomePath(pluginRoot)
	if (path.isAbsolute(expanded)) {
		return expanded as AbsolutePath
	}

	return path.resolve(rootPath, expanded) as AbsolutePath
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

function expandHomePath(value: string): string {
	if (value === "~") {
		return path.resolve(process.env.HOME ?? "")
	}

	if (value.startsWith("~/")) {
		return path.join(process.env.HOME ?? "", value.slice(2))
	}

	return value
}
