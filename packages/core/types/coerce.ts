import path from "node:path"
import type {
	AbsolutePath,
	AgentId,
	Alias,
	GithubRef,
	GitUrl,
	NonEmptyString,
	RemoteMarketplaceUrl,
} from "@/types/branded"
import type { GitRef } from "@/types/declaration"

export const VALID_AGENT_IDS: ReadonlyArray<AgentId> = [
	"amp",
	"claude-code",
	"codex",
	"opencode",
	"factory",
] as const

const VALID_AGENT_IDS_SET: ReadonlySet<string> = new Set(VALID_AGENT_IDS)

export function coerceAgentId(value: string): AgentId | null {
	const trimmed = value.trim()
	if (!VALID_AGENT_IDS_SET.has(trimmed)) return null
	return trimmed as AgentId
}

export function coerceNonEmpty(value: string): NonEmptyString | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) return null
	return trimmed as NonEmptyString
}

const ALIAS_INVALID_CHARS = /[/\\.:]/

export function coerceAlias(value: string): Alias | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) return null
	if (ALIAS_INVALID_CHARS.test(trimmed)) return null
	return trimmed as Alias
}

export function coerceAbsolutePath(
	value: string,
	basePath?: string,
): AbsolutePath | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) return null

	let resolved: string
	if (path.isAbsolute(trimmed)) {
		resolved = path.normalize(trimmed)
	} else if (basePath) {
		resolved = path.resolve(basePath, trimmed)
	} else {
		return null
	}

	return resolved as AbsolutePath
}

export function coerceAbsolutePathDirect(value: string): AbsolutePath | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) return null
	if (!path.isAbsolute(trimmed)) return null
	return path.normalize(trimmed) as AbsolutePath
}

export function assertAbsolutePathDirect(value: string): AbsolutePath {
	const result = coerceAbsolutePathDirect(value)
	if (!result) {
		throw new Error(`Expected absolute path, got: ${value}`)
	}
	return result
}

const SSH_GIT_PATTERN = /^git@([^:]+):(.+?)(?:\.git)?$/
const HTTP_GIT_PATTERN = /^(https?):\/\/([^/]+)\/(.+?)(?:\.git)?$/

export function coerceGitUrl(value: string): GitUrl | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) return null

	const sshMatch = SSH_GIT_PATTERN.exec(trimmed)
	if (sshMatch) {
		const [, host, repoPath] = sshMatch
		return `git@${host}:${repoPath}` as GitUrl
	}

	const httpMatch = HTTP_GIT_PATTERN.exec(trimmed)
	if (httpMatch) {
		const [, scheme, host, repoPath] = httpMatch
		return `${scheme}://${host}/${repoPath}` as GitUrl
	}

	return null
}

export function coerceRemoteMarketplaceUrl(value: string): RemoteMarketplaceUrl | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) return null

	let parsed: URL
	try {
		parsed = new URL(trimmed)
	} catch {
		return null
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return null
	}

	if (!parsed.pathname.endsWith("marketplace.json")) {
		return null
	}

	return trimmed as RemoteMarketplaceUrl
}

const GITHUB_REF_PATTERN = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/

export function coerceGithubRef(value: string): GithubRef | null {
	const trimmed = value.trim()
	if (trimmed.length === 0) return null

	const match = GITHUB_REF_PATTERN.exec(trimmed)
	if (!match) return null

	const [, owner, repo] = match
	if (!owner || !repo) return null

	return trimmed as GithubRef
}

export interface RawGitRefFields {
	tag?: string
	branch?: string
	rev?: string
}

export function coerceGitRef(fields: RawGitRefFields): GitRef | null {
	const tag = fields.tag?.trim()
	const branch = fields.branch?.trim()
	const rev = fields.rev?.trim()

	const present = [tag, branch, rev].filter((value) => value && value.length > 0)
	if (present.length !== 1) {
		return null
	}

	if (tag) {
		const value = coerceNonEmpty(tag)
		return value ? { type: "tag", value } : null
	}
	if (branch) {
		const value = coerceNonEmpty(branch)
		return value ? { type: "branch", value } : null
	}
	if (rev) {
		const value = coerceNonEmpty(rev)
		return value ? { type: "rev", value } : null
	}

	return null
}
