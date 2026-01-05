import type { Result } from "@skills-supply/core"
import { env } from "@/env"
import type { DiscoveryError } from "@/types/errors"

export interface GithubRepoMetadata {
	owner: string
	stars: number
	description: string | null
	topics: string[]
	license: string | null
	language: string | null
	updatedAt: Date
}

export type GithubResult = Result<GithubRepoMetadata, DiscoveryError>

export async function fetchGithubRepoMetadata(githubRepo: string): Promise<GithubResult> {
	const url = `https://api.github.com/repos/${githubRepo}`
	const headers: Record<string, string> = {
		Accept: [
			"application/vnd.github+json",
			"application/vnd.github.mercy-preview+json",
		].join(", "),
		"User-Agent": "skills-supply-discovery",
	}

	if (env.GITHUB_TOKEN) {
		headers.Authorization = `token ${env.GITHUB_TOKEN}`
	}

	let response: Response
	try {
		response = await fetch(url, { headers })
	} catch (error) {
		return {
			error: {
				message: "GitHub request failed.",
				rawError: error instanceof Error ? error : undefined,
				source: url,
				type: "network",
			},
			ok: false,
		}
	}

	if (response.status === 404) {
		return {
			error: {
				message: "GitHub repo not found (404).",
				target: "repo",
				type: "not_found",
			},
			ok: false,
		}
	}

	if (response.status === 403 || response.status === 429) {
		return {
			error: {
				message: "GitHub rate limit exceeded.",
				retryable: true,
				source: url,
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	if (!response.ok) {
		return {
			error: {
				message: `GitHub request failed with status ${response.status}.`,
				source: url,
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	let payload: {
		owner?: { login?: string }
		stargazers_count?: number
		description?: string | null
		topics?: string[]
		license?: { spdx_id?: string | null }
		language?: string | null
		pushed_at?: string
	}
	try {
		payload = (await response.json()) as typeof payload
	} catch (error) {
		return {
			error: {
				message: "GitHub response parsing failed.",
				rawError: error instanceof Error ? error : undefined,
				source: "github",
				type: "parse",
			},
			ok: false,
		}
	}

	const owner = payload.owner?.login
	const stars = payload.stargazers_count
	const updatedAtRaw = payload.pushed_at
	if (!owner || typeof stars !== "number" || !updatedAtRaw) {
		return {
			error: {
				message: "GitHub response missing required fields.",
				source: "github",
				type: "parse",
			},
			ok: false,
		}
	}

	const updatedAt = new Date(updatedAtRaw)
	if (Number.isNaN(updatedAt.getTime())) {
		return {
			error: {
				message: "GitHub response has invalid pushed_at timestamp.",
				source: "github",
				type: "parse",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			description: payload.description ?? null,
			language: payload.language ?? null,
			license: normalizeLicense(payload.license?.spdx_id),
			owner,
			stars,
			topics: payload.topics ?? [],
			updatedAt,
		},
	}
}

function normalizeLicense(value: string | null | undefined): string | null {
	if (!value || value === "NOASSERTION") {
		return null
	}

	return value
}
