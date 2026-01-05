import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { Result } from "@skills-supply/core"
import { consola } from "consola"
import type { Job } from "pg-boss"
import { formatErrorChain, printRawErrorChain } from "@/commands/outcome"
import { db } from "@/db"
import { upsertRepoPackages } from "@/db/indexed-packages"
import { type ScanUnit, scanRepo } from "@/detection/scan"
import { createBoss, DISCOVERY_QUEUE } from "@/queue/boss"
import { fetchGithubRepoMetadata } from "@/sources/github"
import type { DiscoveryError, IoError } from "@/types/errors"

const execFileAsync = promisify(execFile)

interface WorkerOptions {
	concurrency: number
	limit?: number
}

type RepoProcessResult =
	| { ok: true; retryable: false }
	| { ok: false; retryable: boolean; error: DiscoveryError }

export async function workerCommand(options: WorkerOptions): Promise<void> {
	const boss = await createBoss()
	const maxJobs = options.limit
	let processed = 0
	let stopRequested = false

	consola.success("Discovery worker running.")
	process.on("SIGINT", async () => {
		consola.info("Stopping discovery worker...")
		await boss.stop()
		await db.destroy()
		process.exit(0)
	})

	const workerCount =
		typeof maxJobs === "number"
			? Math.min(options.concurrency, maxJobs)
			: options.concurrency

	for (let i = 0; i < workerCount; i += 1) {
		await boss.work(
			DISCOVERY_QUEUE,
			{ batchSize: 1 },
			async (jobs: Job<{ github_repo?: string }>[]) => {
				const job = jobs[0]
				if (!job) {
					return
				}

				const githubRepo = job.data.github_repo
				if (!githubRepo || typeof githubRepo !== "string") {
					consola.warn("Discovery job missing github_repo. Skipping.")
					return
				}

				const result = await processRepo(githubRepo)
				processed += 1
				if (typeof maxJobs === "number" && processed >= maxJobs) {
					void requestStop()
				}
				if (!result.ok) {
					const message = formatErrorChain(result.error)
					if (result.retryable) {
						printRawErrorChain(result.error)
						throw new Error(message)
					}
					consola.warn(message)
					printRawErrorChain(result.error)
				}
			},
		)
	}

	async function requestStop(): Promise<void> {
		if (stopRequested) {
			return
		}
		stopRequested = true
		consola.info(`Limit reached (${maxJobs}). Stopping discovery worker...`)
		try {
			await boss.stop()
		} finally {
			await db.destroy()
			process.exit(0)
		}
	}
}

async function processRepo(githubRepo: string): Promise<RepoProcessResult> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "sk-scan-"))
	const repoDir = path.join(tempDir, "repo")
	try {
		const cloneResult = await cloneRepo(githubRepo, repoDir)
		if (!cloneResult.ok) {
			return {
				error: cloneResult.error,
				ok: false,
				retryable: false,
			}
		}

		const scanResult = await scanRepo(repoDir, githubRepo)
		if (!scanResult.ok) {
			return {
				error: scanResult.error,
				ok: false,
				retryable: false,
			}
		}

		const units = scanResult.value.units
		for (const warning of scanResult.value.warnings) {
			consola.warn(`${githubRepo}: ${warning.message}`)
		}
		if (units.length === 0) {
			await upsertRepoPackages(db, githubRepo, [])
			consola.info(`${githubRepo}: no installable packages found.`)
			return { ok: true, retryable: false }
		}

		const ghResult = await fetchGithubRepoMetadata(githubRepo)
		if (!ghResult.ok) {
			const retryable = ghResult.error.type === "network"
			return {
				error: ghResult.error,
				ok: false,
				retryable,
			}
		}

		const repoName = githubRepo.split("/")[1] ?? githubRepo
		const packages = units.map((unit: ScanUnit) => {
			const name = unit.metadata?.name ?? repoName
			const description =
				unit.kind === "manifest"
					? (unit.metadata?.description ?? ghResult.value.description)
					: (unit.metadata?.description ?? null)

			return {
				declaration: JSON.stringify(unit.declaration),
				description: description ?? null,
				gh_description: ghResult.value.description,
				gh_language: ghResult.value.language,
				gh_license: ghResult.value.license,
				gh_owner: ghResult.value.owner,
				gh_stars: ghResult.value.stars,
				gh_topics: ghResult.value.topics,
				gh_updated_at: ghResult.value.updatedAt,
				name,
				path: unit.path,
			}
		})

		await upsertRepoPackages(db, githubRepo, packages)
		consola.success(`${githubRepo}: indexed ${packages.length} packages.`)
		return { ok: true, retryable: false }
	} catch (error) {
		return {
			error: unexpectedError(`Unexpected error for ${githubRepo}.`, error),
			ok: false,
			retryable: true,
		}
	} finally {
		await rm(tempDir, { force: true, recursive: true })
	}
}

async function cloneRepo(
	githubRepo: string,
	destination: string,
): Promise<Result<void, IoError>> {
	try {
		await execFileAsync("git", [
			"clone",
			"--depth",
			"1",
			`https://github.com/${githubRepo}.git`,
			destination,
		])
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: "git clone failed.",
				operation: "execFile",
				path: destination,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

function unexpectedError(message: string, error: unknown): DiscoveryError {
	if (error && typeof error === "object" && "type" in error && "message" in error) {
		const maybeBase = error as { type?: unknown; message?: unknown }
		if (typeof maybeBase.type === "string" && typeof maybeBase.message === "string") {
			return {
				cause: error as DiscoveryError,
				message,
				type: "unexpected",
			}
		}
	}
	return {
		message,
		rawError: error instanceof Error ? error : undefined,
		type: "unexpected",
	}
}
