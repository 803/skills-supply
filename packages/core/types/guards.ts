import type {
	AbsolutePath,
	AgentId,
	Alias,
	GithubRef,
	GitUrl,
	NonEmptyString,
	RemoteMarketplaceUrl,
} from "@/types/branded"
import {
	coerceAbsolutePathDirect,
	coerceAgentId,
	coerceAlias,
	coerceGithubRef,
	coerceGitUrl,
	coerceNonEmpty,
	coerceRemoteMarketplaceUrl,
} from "@/types/coerce"

export function isNonEmpty(value: string): value is NonEmptyString {
	return coerceNonEmpty(value) !== null
}

export function isAlias(value: string): value is Alias {
	return coerceAlias(value) !== null
}

export function isAbsolutePath(value: string): value is AbsolutePath {
	return coerceAbsolutePathDirect(value) !== null
}

export function isGitUrl(value: string): value is GitUrl {
	return coerceGitUrl(value) !== null
}

export function isRemoteMarketplaceUrl(value: string): value is RemoteMarketplaceUrl {
	return coerceRemoteMarketplaceUrl(value) !== null
}

export function isGithubRef(value: string): value is GithubRef {
	return coerceGithubRef(value) !== null
}

export function isAgentId(value: string): value is AgentId {
	return coerceAgentId(value) !== null
}
