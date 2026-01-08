import type { Result } from "@skills-supply/core"
import { consola } from "consola"
import { db } from "@/db"
import { listIndexedRepos } from "@/db/indexed-packages"
import { clearQueue, createBoss, DISCOVERY_QUEUE } from "@/queue/boss"
import { discover as fetchFromBql } from "@/sources/skillsmp-bql"
import type { DiscoveryError } from "@/types/errors"

interface EnqueueOptions {
	clear?: boolean
	newOnly?: boolean
}

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

		const SOURCES = {
			"skillsmp-bql": fetchFromBql,
		} as const
		type SourceName = keyof typeof SOURCES

		if (!(source in SOURCES)) {
			return {
				error: {
					field: "source",
					message: `Unknown source: ${source}`,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const fetchFromSource = SOURCES[source as SourceName]

		const existing = options.newOnly ? new Set(await listIndexedRepos(db)) : null

		let queued = 0

		const result = await fetchFromSource(async (urls) => {
			let invalidRepo = 0
			let alreadyIndexed = 0
			let duplicateJob = 0

			for (const url of urls) {
				const repo = extractRepoFromGithubUrl(url)
				if (!repo) {
					invalidRepo++
					consola.debug(`Invalid githubUrl: ${url}`)
					continue
				}
				if (existing?.has(repo)) {
					alreadyIndexed++
					continue
				}
				const jobId = await boss.send(
					DISCOVERY_QUEUE,
					{ github_repo: repo },
					{ singletonKey: repo },
				)
				if (jobId) {
					queued += 1
				} else {
					duplicateJob++
				}
			}

			consola.info(
				`Batch stats: total=${urls.length}, invalidRepo=${invalidRepo}, alreadyIndexed=${alreadyIndexed}, duplicateJob=${duplicateJob}`,
			)

			consola.info(`${queued} repos queued so far`)

			return "continue"
		})

		if (!result.ok) {
			return { error: result.error, ok: false }
		}

		consola.success(`Enqueued ${queued} repos from ${source}.`)
		return { ok: true, value: undefined }
	} finally {
		await boss.stop()
		await db.destroy()
	}
}

function extractRepoFromGithubUrl(url: string): string | null {
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
