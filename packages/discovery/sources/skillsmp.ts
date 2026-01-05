import type { Result } from "@skills-supply/core"
import { env } from "@/env"
import type { DiscoveryError } from "@/types/errors"

interface SkillsmpPagination {
	page: number
	limit: number
	total: number
	totalPages: number
	hasNext: boolean
	hasPrev: boolean
}

interface SkillsmpSkill {
	githubUrl?: string
}

interface SkillsmpResponse {
	success: boolean
	data?: {
		skills?: SkillsmpSkill[]
		pagination?: SkillsmpPagination
	}
}

export type SkillsmpResult = Result<
	{ skills: SkillsmpSkill[]; pagination: SkillsmpPagination },
	DiscoveryError
>

export async function fetchSkillsmpPage(
	page: number,
	limit: number,
): Promise<SkillsmpResult> {
	if (!env.SKILLSMP_API_KEY) {
		return {
			error: {
				field: "SKILLSMP_API_KEY",
				message: "SKILLSMP_API_KEY is required to query SkillsMP.",
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const url = new URL("https://skillsmp.com/api/v1/skills/search")
	url.searchParams.set("q", "*")
	url.searchParams.set("limit", String(limit))
	url.searchParams.set("page", String(page))
	url.searchParams.set("sortBy", "stars")

	let response: Response
	try {
		response = await fetch(url.toString(), {
			headers: {
				Authorization: `Bearer ${env.SKILLSMP_API_KEY}`,
			},
		})
	} catch (error) {
		return {
			error: {
				message: "SkillsMP request failed.",
				rawError: error instanceof Error ? error : undefined,
				source: url.toString(),
				type: "network",
			},
			ok: false,
		}
	}

	if (!response.ok) {
		if (response.status === 429) {
			const headers = extractRateLimitHeaders(response.headers)
			const retryAfterSeconds = parseRetryAfterSeconds(
				headers["retry-after"] ?? null,
			)
			return {
				error: {
					headers,
					message: "SkillsMP rate limit exceeded.",
					retryAfterSeconds: retryAfterSeconds ?? undefined,
					retryable: true,
					source: url.toString(),
					status: response.status,
					type: "network",
				},
				ok: false,
			}
		}

		return {
			error: {
				message: `SkillsMP request failed with status ${response.status}.`,
				source: url.toString(),
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	let payload: SkillsmpResponse
	try {
		payload = (await response.json()) as SkillsmpResponse
	} catch (error) {
		return {
			error: {
				message: "SkillsMP response parsing failed.",
				rawError: error instanceof Error ? error : undefined,
				source: "skillsmp",
				type: "parse",
			},
			ok: false,
		}
	}

	const skills = payload.data?.skills
	const pagination = payload.data?.pagination
	if (!payload.success || !skills || !pagination) {
		return {
			error: {
				message: "SkillsMP response was missing expected data.",
				source: "skillsmp",
				type: "parse",
			},
			ok: false,
		}
	}

	return { ok: true, value: { pagination, skills } }
}

export function extractRepoFromGithubUrl(url: string): string | null {
	const match = url.match(/github\.com\/([^/]+\/[^/]+)/)
	if (!match) {
		return null
	}

	const repo = match[1]
	if (!repo) {
		return null
	}

	return repo.replace(/\.git$/, "")
}

const RATE_LIMIT_HEADER_NAMES = [
	"retry-after",
	"x-ratelimit-limit",
	"x-ratelimit-remaining",
	"x-ratelimit-reset",
	"ratelimit-limit",
	"ratelimit-remaining",
	"ratelimit-reset",
	"ratelimit-policy",
	"date",
]

function extractRateLimitHeaders(headers: Headers): Record<string, string> {
	const entries: Record<string, string> = {}
	for (const name of RATE_LIMIT_HEADER_NAMES) {
		const value = headers.get(name)
		if (value) {
			entries[name] = value
		}
	}
	return entries
}

function parseRetryAfterSeconds(value: string | null): number | null {
	if (!value) {
		return null
	}

	const numeric = Number.parseInt(value, 10)
	if (Number.isFinite(numeric) && numeric >= 0) {
		return numeric
	}

	const parsedDate = Date.parse(value)
	if (!Number.isNaN(parsedDate)) {
		const deltaMs = parsedDate - Date.now()
		if (deltaMs > 0) {
			return Math.ceil(deltaMs / 1000)
		}
	}

	return null
}
