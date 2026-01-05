import type { Result } from "@skills-supply/core"
import { consola } from "consola"
import { db } from "@/db"
import { listIndexedRepos } from "@/db/indexed-packages"
import { clearQueue, createBoss, DISCOVERY_QUEUE } from "@/queue/boss"
import {
	extractRepoFromGithubUrl,
	fetchSkillsmpPage,
	type SkillsmpResult,
} from "@/sources/skillsmp"
import type { DiscoveryError } from "@/types/errors"

interface EnqueueOptions {
	clear?: boolean
	newOnly?: boolean
}

const RATE_LIMIT_MAX_RETRIES = 8
const RATE_LIMIT_BASE_DELAY_MS = 2000
const RATE_LIMIT_MAX_DELAY_MS = 60000

export async function enqueueCommand(
	source: string | undefined,
	options: EnqueueOptions,
): Promise<Result<void, DiscoveryError>> {
	const boss = await createBoss()
	try {
		if (options.clear) {
			await clearQueue(boss)
			consola.success("Discovery queue cleared.")
			return { ok: true, value: undefined }
		}

		if (!source) {
			return {
				error: {
					field: "source",
					message: "Discovery source is required unless --clear is set.",
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		if (source !== "skillsmp") {
			return {
				error: {
					field: "source",
					message: `Unsupported source: ${source}`,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const existing = options.newOnly ? new Set(await listIndexedRepos(db)) : null

		let page = 1
		let queued = 0
		let hasNext = true
		const limit = 100

		while (hasNext) {
			const response = await fetchSkillsmpPageWithBackoff(page, limit)
			if (!response.ok) {
				return { error: response.error, ok: false }
			}

			for (const skill of response.value.skills) {
				if (!skill.githubUrl) {
					continue
				}
				const repo = extractRepoFromGithubUrl(skill.githubUrl)
				if (!repo) {
					continue
				}
				if (existing?.has(repo)) {
					continue
				}
				const jobId = await boss.send(
					DISCOVERY_QUEUE,
					{ github_repo: repo },
					{ singletonKey: repo },
				)
				if (jobId) {
					queued += 1
				}
			}

			consola.info(
				`Page ${response.value.pagination.page}/${response.value.pagination.totalPages} | ${queued} repos queued`,
			)

			hasNext = response.value.pagination.hasNext
			page += 1
		}

		consola.success(`Enqueued ${queued} repos from SkillsMP.`)
		return { ok: true, value: undefined }
	} finally {
		await boss.stop()
		await db.destroy()
	}
}

async function fetchSkillsmpPageWithBackoff(
	page: number,
	limit: number,
): Promise<SkillsmpResult> {
	let attempts = 0

	while (true) {
		const response = await fetchSkillsmpPage(page, limit)
		if (response.ok) {
			return response
		}

		if (response.error.type !== "network" || !response.error.retryable) {
			return response
		}

		attempts += 1

		const headersSummary = formatRateLimitHeaders(response.error.headers ?? {})
		consola.warn(
			[
				`SkillsMP rate limit hit (attempt ${attempts}/${RATE_LIMIT_MAX_RETRIES}).`,
				headersSummary ? `Headers: ${headersSummary}` : "Headers: <none>",
			].join(" "),
		)

		if (attempts >= RATE_LIMIT_MAX_RETRIES) {
			return {
				error: {
					...response.error,
					message: `SkillsMP rate limit exceeded after ${attempts} attempts.`,
				},
				ok: false,
			}
		}

		const waitMs = computeRateLimitDelayMs(response.error.retryAfterSeconds, attempts)
		consola.info(`Waiting ${Math.ceil(waitMs / 1000)}s before retrying page ${page}.`)
		await sleep(waitMs)
	}
}

function computeRateLimitDelayMs(
	retryAfterSeconds: number | undefined,
	attempt: number,
): number {
	if (retryAfterSeconds && retryAfterSeconds > 0) {
		return retryAfterSeconds * 1000
	}

	const expDelay = RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1)
	return Math.min(expDelay, RATE_LIMIT_MAX_DELAY_MS)
}

function formatRateLimitHeaders(headers: Record<string, string>): string {
	const entries = Object.entries(headers)
	if (entries.length === 0) {
		return ""
	}

	return entries.map(([key, value]) => `${key}=${value}`).join(", ")
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}
