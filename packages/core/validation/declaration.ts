import { z } from "zod"
import type { NonEmptyString } from "@/types/branded"
import {
	coerceAbsolutePathDirect,
	coerceGithubRef,
	coerceGitUrl,
	coerceNonEmpty,
	coerceRemoteMarketplaceUrl,
} from "@/types/coerce"
import type { GitRef, RawDeclaration, ValidatedDeclaration } from "@/types/declaration"
import type { Result } from "@/types/error"

const NonEmptySchema = z.string().trim().min(1)

const GithubDeclSchema = z
	.object({
		branch: NonEmptySchema.optional(),
		gh: NonEmptySchema,
		path: NonEmptySchema.optional(),
		rev: NonEmptySchema.optional(),
		tag: NonEmptySchema.optional(),
	})
	.strict()

const GitDeclSchema = z
	.object({
		branch: NonEmptySchema.optional(),
		git: NonEmptySchema,
		path: NonEmptySchema.optional(),
		rev: NonEmptySchema.optional(),
		tag: NonEmptySchema.optional(),
	})
	.strict()

const RegistryDeclSchema = z
	.object({
		registry: NonEmptySchema,
		version: NonEmptySchema.optional(),
	})
	.strict()

const LocalDeclSchema = z.object({ path: NonEmptySchema }).strict()

const ClaudePluginSchema = z
	.object({
		marketplace: NonEmptySchema,
		plugin: NonEmptySchema,
		type: z.literal("claude-plugin"),
	})
	.strict()

const RawDeclSchema = z.union([
	GithubDeclSchema,
	GitDeclSchema,
	RegistryDeclSchema,
	LocalDeclSchema,
	ClaudePluginSchema,
])

export function validateDeclaration(raw: RawDeclaration): Result<ValidatedDeclaration> {
	if (typeof raw === "string") {
		return parseStringDeclaration(raw)
	}

	const parsed = RawDeclSchema.safeParse(raw)
	if (!parsed.success) {
		return {
			error: {
				field: "declaration",
				message: "Declaration validation failed.",
				source: "zod",
				type: "validation",
				zodError: parsed.error,
			},
			ok: false,
		}
	}

	const value = parsed.data
	if ("gh" in value) {
		return parseGithubDeclaration(value)
	}

	if ("git" in value) {
		return parseGitDeclaration(value)
	}

	if ("registry" in value) {
		return parseRegistryDeclaration(value)
	}

	if ("type" in value) {
		return parseClaudePluginDeclaration(value)
	}

	return parseLocalDeclaration(value)
}

function parseStringDeclaration(raw: string): Result<ValidatedDeclaration> {
	const trimmed = raw.trim()
	if (!trimmed) {
		const message = "Declaration must not be empty."
		return {
			error: {
				field: "declaration",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const github = coerceGithubRef(trimmed)
	if (github) {
		return {
			ok: true,
			value: {
				gh: github,
				type: "github",
			},
		}
	}

	const registry = parseRegistryString(trimmed)
	if (!registry.ok) {
		return registry
	}

	return {
		ok: true,
		value: {
			name: registry.value.name,
			org: registry.value.org,
			type: "registry",
			version: registry.value.version,
		},
	}
}

function parseGithubDeclaration(
	value: z.infer<typeof GithubDeclSchema>,
): Result<ValidatedDeclaration> {
	const gh = coerceGithubRef(value.gh)
	if (!gh) {
		const message = `Invalid GitHub reference: ${value.gh}.`
		return {
			error: {
				field: "gh",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const refResult = parseGitRef(value)
	if (!refResult.ok) {
		return refResult
	}

	const pathValue = value.path ? coerceNonEmpty(value.path) : undefined
	if (value.path && !pathValue) {
		const message = "Path must be non-empty."
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

	return {
		ok: true,
		value: {
			gh,
			path: pathValue ?? undefined,
			ref: refResult.value,
			type: "github",
		},
	}
}

function parseGitDeclaration(
	value: z.infer<typeof GitDeclSchema>,
): Result<ValidatedDeclaration> {
	const url = coerceGitUrl(value.git)
	if (!url) {
		const message = `Invalid git URL: ${value.git}.`
		return {
			error: {
				field: "git",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const refResult = parseGitRef(value)
	if (!refResult.ok) {
		return refResult
	}

	const pathValue = value.path ? coerceNonEmpty(value.path) : undefined
	if (value.path && !pathValue) {
		const message = "Path must be non-empty."
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

	return {
		ok: true,
		value: {
			path: pathValue ?? undefined,
			ref: refResult.value,
			type: "git",
			url,
		},
	}
}

function parseRegistryDeclaration(
	value: z.infer<typeof RegistryDeclSchema>,
): Result<ValidatedDeclaration> {
	if (!value.version) {
		const message = "Registry declarations must include a version."
		return {
			error: {
				field: "version",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const parsed = parseRegistryName(value.registry)
	if (!parsed.ok) {
		return parsed
	}

	const version = coerceNonEmpty(value.version)
	if (!version) {
		const message = "Registry version must be non-empty."
		return {
			error: {
				field: "version",
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
			name: parsed.value.name,
			org: parsed.value.org,
			type: "registry",
			version,
		},
	}
}

function parseLocalDeclaration(
	value: z.infer<typeof LocalDeclSchema>,
): Result<ValidatedDeclaration> {
	const absolutePath = coerceAbsolutePathDirect(value.path)
	if (!absolutePath) {
		const message = "Local path must be absolute."
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

function parseClaudePluginDeclaration(
	value: z.infer<typeof ClaudePluginSchema>,
): Result<ValidatedDeclaration> {
	const plugin = coerceNonEmpty(value.plugin)
	if (!plugin) {
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

	const marketplace =
		coerceRemoteMarketplaceUrl(value.marketplace) ??
		coerceAbsolutePathDirect(value.marketplace) ??
		coerceGitUrl(value.marketplace) ??
		coerceGithubRef(value.marketplace)
	if (!marketplace) {
		const message =
			"Marketplace must be an owner/repo, git URL, absolute path, or https URL ending in marketplace.json."
		return {
			error: {
				field: "marketplace",
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
			marketplace,
			plugin,
			type: "claude-plugin",
		},
	}
}

function parseGitRef(value: {
	tag?: string
	branch?: string
	rev?: string
}): Result<GitRef | undefined> {
	const candidates = [value.tag, value.branch, value.rev].filter(
		(ref) => typeof ref === "string" && ref.trim().length > 0,
	)

	if (candidates.length === 0) {
		return { ok: true, value: undefined }
	}

	if (candidates.length > 1) {
		const message = "Only one of tag, branch, or rev may be set."
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

	if (value.tag) {
		const tag = coerceNonEmpty(value.tag)
		if (!tag) {
			const message = "Tag must be non-empty."
			return {
				error: {
					field: "tag",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: { type: "tag", value: tag } }
	}

	if (value.branch) {
		const branch = coerceNonEmpty(value.branch)
		if (!branch) {
			const message = "Branch must be non-empty."
			return {
				error: {
					field: "branch",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: { type: "branch", value: branch } }
	}

	const rev = value.rev ? coerceNonEmpty(value.rev) : undefined
	if (!rev) {
		const message = "Rev must be non-empty."
		return {
			error: {
				field: "rev",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	return { ok: true, value: { type: "rev", value: rev } }
}

type RegistryParts = {
	name: NonEmptyString
	org?: NonEmptyString
	version: NonEmptyString
}

function parseRegistryString(value: string): Result<RegistryParts> {
	const atOrgMatch = value.match(/^@([^/]+)\/([^@]+)@(.+)$/)
	if (atOrgMatch) {
		const [, orgStr, nameStr, versionStr] = atOrgMatch
		if (!orgStr || !nameStr || !versionStr) {
			const message = `Invalid registry declaration: ${value}.`
			return {
				error: {
					field: "registry",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const org = coerceNonEmpty(orgStr)
		const name = coerceNonEmpty(nameStr)
		const version = coerceNonEmpty(versionStr)
		if (!org || !name || !version) {
			const message = `Invalid registry declaration: ${value}.`
			return {
				error: {
					field: "registry",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: { name, org, version } }
	}

	const simpleMatch = value.match(/^([^@]+)@(.+)$/)
	if (simpleMatch) {
		const [, nameStr, versionStr] = simpleMatch
		if (!nameStr || !versionStr) {
			const message = `Invalid registry declaration: ${value}.`
			return {
				error: {
					field: "registry",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const name = coerceNonEmpty(nameStr)
		const version = coerceNonEmpty(versionStr)
		if (!name || !version) {
			const message = `Invalid registry declaration: ${value}.`
			return {
				error: {
					field: "registry",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: { name, version } }
	}

	return {
		error: {
			field: "registry",
			message: `Invalid registry declaration: ${value}. Expected @org/name@version or name@version.`,
			source: "manual",
			type: "validation",
		},
		ok: false,
	}
}

type RegistryNameParts = { name: NonEmptyString; org?: NonEmptyString }

function parseRegistryName(value: string): Result<RegistryNameParts> {
	const trimmed = value.trim()
	if (!trimmed) {
		const message = "Registry name must be non-empty."
		return {
			error: {
				field: "registry",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (trimmed.startsWith("@")) {
		const withoutAt = trimmed.slice(1)
		const parts = withoutAt.split("/")
		if (parts.length !== 2) {
			const message = "Registry name must be in @org/name format."
			return {
				error: {
					field: "registry",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const org = coerceNonEmpty(parts[0] ?? "")
		const name = coerceNonEmpty(parts[1] ?? "")
		if (!org || !name) {
			const message = "Registry name must be in @org/name format."
			return {
				error: {
					field: "registry",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return { ok: true, value: { name, org } }
	}

	const name = coerceNonEmpty(trimmed)
	if (!name) {
		const message = "Registry name must be non-empty."
		return {
			error: {
				field: "registry",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	return { ok: true, value: { name } }
}
