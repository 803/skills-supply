import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { assertAbsolutePathDirect, type Result } from "@skills-supply/core"
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

const execFileAsync = promisify(execFile)

export async function fetchGithubRepoMetadata(githubRepo: string): Promise<GithubResult> {
	const url = `https://api.github.com/repos/${githubRepo}`
	const responseResult = await fetchGithubApi({ url })
	if (!responseResult.ok) {
		return { error: responseResult.error, ok: false }
	}
	const response = responseResult.value

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

/**
 * Low-level GitHub API fetch with standard error handling.
 * Returns the Response on success (2xx or 404 when handle404AsNotFound=false).
 * Handles network errors, rate limiting (403/429), and non-2xx responses.
 */
async function fetchGithubApi(options: {
	url: string
	method?: string
	handle404AsNotFound?: boolean
}): Promise<Result<Response, DiscoveryError>> {
	const { url, method = "GET", handle404AsNotFound = true } = options
	const headers = buildGithubHeaders()

	let response: Response
	try {
		response = await fetch(url, { headers, method })
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

	const details =
		response.status === 200 ? null : await readGithubResponseDetails(response, url)

	if (response.status === 404 && handle404AsNotFound) {
		return {
			error: {
				message: "GitHub repo not found (404).",
				status: response.status,
				target: "repo",
				type: "not_found",
			},
			ok: false,
		}
	}

	if (response.status === 401) {
		return {
			error: {
				message: formatUnauthorizedMessage(details?.message ?? null),
				source: url,
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	if (response.status === 403) {
		if (isRateLimitResponse(response, details?.message ?? null)) {
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

		return {
			error: {
				message: formatForbiddenMessage(details?.message ?? null),
				source: url,
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	if (response.status === 429) {
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

	if (!response.ok && response.status !== 404) {
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

	return { ok: true, value: response }
}

export async function checkRepoExists(
	owner: string,
	repo: string,
): Promise<Result<boolean, DiscoveryError>> {
	const result = await fetchGithubApi({
		handle404AsNotFound: false,
		url: `https://api.github.com/repos/${owner}/${repo}`,
	})
	if (!result.ok) return result
	return { ok: true, value: result.value.status !== 404 }
}

export async function deleteRepo(
	owner: string,
	repo: string,
): Promise<Result<void, DiscoveryError>> {
	const result = await fetchGithubApi({
		method: "DELETE",
		url: `https://api.github.com/repos/${owner}/${repo}`,
	})
	if (!result.ok) return result
	return { ok: true, value: undefined }
}

export async function createFork(
	owner: string,
	repo: string,
): Promise<Result<{ clone_url: string }, DiscoveryError>> {
	const result = await fetchGithubApi({
		method: "POST",
		url: `https://api.github.com/repos/${owner}/${repo}/forks`,
	})
	if (!result.ok) return result

	let payload: { clone_url?: string }
	try {
		payload = (await result.value.json()) as { clone_url?: string }
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

	if (typeof payload.clone_url !== "string" || payload.clone_url.length === 0) {
		return {
			error: {
				message: "GitHub response missing clone_url.",
				source: "github",
				type: "parse",
			},
			ok: false,
		}
	}

	return { ok: true, value: { clone_url: payload.clone_url } }
}

export async function waitForForkReady(
	owner: string,
	repo: string,
	maxWaitMs: number = 60_000,
): Promise<Result<void, DiscoveryError>> {
	const start = Date.now()
	while (Date.now() - start < maxWaitMs) {
		const exists = await checkRepoExists(owner, repo)
		if (!exists.ok) {
			return exists
		}
		if (exists.value) {
			return { ok: true, value: undefined }
		}
		await sleep(2000)
	}

	return {
		error: {
			message: "Timed out waiting for fork to be ready.",
			retryable: true,
			source: "github",
			type: "network",
		},
		ok: false,
	}
}

export async function createPullRequestViaCli(
	workdir: string,
	targetRepo: string,
	head: string,
	title: string,
	body: string,
): Promise<Result<{ url: string }, DiscoveryError>> {
	try {
		const { stdout } = await execFileAsync(
			"gh",
			[
				"pr",
				"create",
				"--repo",
				targetRepo,
				"--head",
				head,
				"--title",
				title,
				"--body",
				body,
			],
			{ cwd: workdir },
		)

		const prUrl = String(stdout).trim()
		if (!prUrl) {
			return {
				error: {
					message: "gh pr create did not return a PR URL.",
					source: "gh",
					type: "parse",
				},
				ok: false,
			}
		}

		return { ok: true, value: { url: prUrl } }
	} catch (error) {
		return {
			error: {
				message: "gh pr create failed.",
				operation: "execFile",
				path: assertAbsolutePathDirect(workdir),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

function normalizeLicense(value: string | null | undefined): string | null {
	if (!value || value === "NOASSERTION") {
		return null
	}

	return value
}

function buildGithubHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: [
			"application/vnd.github+json",
			"application/vnd.github.mercy-preview+json",
		].join(", "),
		"User-Agent": "skills-supply-discovery",
	}

	if (env.GITHUB_TOKEN) {
		const token = env.GITHUB_TOKEN
		const prefix = token.startsWith("github_pat_") ? "Bearer" : "token"
		headers.Authorization = `${prefix} ${token}`
	}

	return headers
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

function isRateLimitResponse(response: Response, message: string | null): boolean {
	if (response.headers.get("x-ratelimit-remaining") === "0") {
		return true
	}
	if (message?.toLowerCase().includes("rate limit")) {
		return true
	}
	return false
}

function formatForbiddenMessage(message: string | null): string {
	if (message && message.trim().length > 0) {
		return `GitHub request forbidden (403): ${message.trim()}`
	}
	return "GitHub request forbidden (403)."
}

function formatUnauthorizedMessage(message: string | null): string {
	if (message && message.trim().length > 0) {
		return `GitHub request unauthorized (401): ${message.trim()}`
	}
	return "GitHub request unauthorized (401)."
}

async function readGithubResponseDetails(
	response: Response,
	url: string,
): Promise<{ body: string | null; message: string | null }> {
	const body = await readGithubResponseBody(response.clone())

	if (response.status !== 200) {
		if (body && response.status >= 400) {
			console.error(
				`[github] ${response.status} response body from ${url}: ${body}`,
			)
		} else {
			console.error(`[github] ${response.status} response from ${url}`)
		}
	}

	const message = response.status >= 400 ? extractGithubMessage(body) : null
	return { body, message }
}

async function readGithubResponseBody(response: Response): Promise<string | null> {
	try {
		const text = await response.text()
		const trimmed = text.trim()
		return trimmed.length > 0 ? trimmed : null
	} catch {
		return null
	}
}

function extractGithubMessage(body: string | null): string | null {
	if (!body) {
		return null
	}

	try {
		const parsed = JSON.parse(body) as { message?: unknown }
		if (typeof parsed.message === "string") {
			return parsed.message
		}
	} catch {
		// fall through to raw body
	}

	return body
}
