import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { coerceValidatedDeclaration, type Result } from "@skills-supply/core"
import { consola } from "consola"
import type { Job, PgBoss } from "pg-boss"
import { formatErrorChain, printRawErrorChain } from "@/commands/outcome"
import { db } from "@/db"
import type { IndexedPackageInsertWithSkills } from "@/db/indexed-packages"
import { upsertRepoPackages } from "@/db/indexed-packages"
import { type ScanUnit, type ScanWarning, scanRepo } from "@/detection/scan"
import { createBoss, DISCOVERY_QUEUE } from "@/queue/boss"
import { cloneRemoteRepo } from "@/sources/git"
import { fetchGithubRepoMetadata } from "@/sources/github"
import type { DiscoveryError } from "@/types/errors"

interface WorkerOptions {
	concurrency: number
	limit?: number
	dryRun: boolean
}

type RepoProcessResult =
	| {
			ok: true
			retryable: false
			packages: IndexedPackageInsertWithSkills[]
			warnings: ScanWarning[]
	  }
	| { ok: false; retryable: boolean; error: DiscoveryError }

type DryRunWarning = {
	type: string
	message: string
	path?: string
	field?: string
	source?: string
}

type DryRunPayload = {
	event: "discovery.dry-run"
	jobId: string
	githubRepo: string
	packages: IndexedPackageInsertWithSkills[]
	warnings: DryRunWarning[]
}

const PG_BOSS_SCHEMA = "pgboss"
const DRY_RUN_POLL_MS = 1000

export async function workerCommand(options: WorkerOptions): Promise<void> {
	const boss = await createBoss()
	const maxJobs = options.limit
	let processed = 0
	let stopRequested = false

	consola.success(
		options.dryRun
			? "Discovery worker running (dry-run)."
			: "Discovery worker running.",
	)
	process.on("SIGINT", async () => {
		consola.info("Stopping discovery worker...")
		await boss.stop()
		await db.destroy()
		process.exit(0)
	})

	if (options.dryRun) {
		await runDryRunWorker({
			boss,
			concurrency: options.concurrency,
			limit: maxJobs,
			onLimitReached: requestStop,
		})
		return
	}

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
					return
				}

				logRepoWarnings(githubRepo, result.warnings)
				const persistResult = await persistRepoPackages(
					githubRepo,
					result.packages,
				)
				if (!persistResult.ok) {
					const message = formatErrorChain(persistResult.error)
					printRawErrorChain(persistResult.error)
					throw new Error(message)
				}
			},
		)
	}

	async function requestStop(messageOverride?: string): Promise<void> {
		if (stopRequested) {
			return
		}
		stopRequested = true
		const message =
			messageOverride ??
			(typeof maxJobs === "number"
				? `Limit reached (${maxJobs}). Stopping discovery worker...`
				: "Stopping discovery worker...")
		consola.info(message)
		try {
			await boss.stop()
		} finally {
			await db.destroy()
			process.exit(0)
		}
	}
}

async function runDryRunWorker(options: {
	boss: PgBoss
	concurrency: number
	limit?: number
	onLimitReached: (message?: string) => Promise<void>
}): Promise<void> {
	const queue = await options.boss.getQueue(DISCOVERY_QUEUE)
	if (!queue) {
		await options.onLimitReached(
			`Queue ${DISCOVERY_QUEUE} not found. Stopping dry-run worker...`,
		)
		return
	}
	let processed = 0

	while (true) {
		const remaining =
			typeof options.limit === "number" ? options.limit - processed : undefined
		const batchSize =
			typeof remaining === "number"
				? Math.min(options.concurrency, remaining)
				: options.concurrency

		if (batchSize <= 0) {
			await options.onLimitReached()
			return
		}

		const jobs = await options.boss.fetch<{ github_repo?: string }>(DISCOVERY_QUEUE, {
			batchSize,
		})

		if (jobs.length === 0) {
			if (typeof options.limit === "number") {
				await options.onLimitReached(
					"No jobs available. Stopping dry-run worker...",
				)
				return
			}
			await sleep(DRY_RUN_POLL_MS)
			continue
		}

		try {
			await Promise.allSettled(
				jobs.map(async (job) => {
					await handleDryRunJob(job)
				}),
			)
		} finally {
			await resetDryRunJobs(
				options.boss,
				queue.table,
				jobs.map((job) => job.id),
			)
		}

		processed += jobs.length
		if (typeof options.limit === "number" && processed >= options.limit) {
			await options.onLimitReached()
			return
		}
	}
}

async function handleDryRunJob(job: Job<{ github_repo?: string }>): Promise<void> {
	const githubRepo = job.data.github_repo
	if (!githubRepo || typeof githubRepo !== "string") {
		consola.warn("Discovery job missing github_repo. Skipping.")
		return
	}

	const result = await processRepo(githubRepo)
	if (!result.ok) {
		const message = formatErrorChain(result.error)
		consola.warn(message)
		printRawErrorChain(result.error)
		return
	}

	logRepoWarnings(githubRepo, result.warnings)
	emitDryRunPayload({
		event: "discovery.dry-run",
		githubRepo,
		jobId: job.id,
		packages: result.packages,
		warnings: result.warnings.map(serializeWarning),
	})
}

function logRepoWarnings(githubRepo: string, warnings: ScanWarning[]): void {
	for (const warning of warnings) {
		consola.warn(`${githubRepo}: ${warning.message}`)
	}
}

async function persistRepoPackages(
	githubRepo: string,
	packages: IndexedPackageInsertWithSkills[],
): Promise<Result<void, DiscoveryError>> {
	try {
		if (packages.length === 0) {
			await upsertRepoPackages(db, githubRepo, [])
			consola.info(`${githubRepo}: no installable packages found.`)
			return { ok: true, value: undefined }
		}
		await upsertRepoPackages(db, githubRepo, packages)
		consola.success(`${githubRepo}: indexed ${packages.length} packages.`)
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: unexpectedError(
				`Unexpected error while indexing ${githubRepo}.`,
				error,
			),
			ok: false,
		}
	}
}

function serializeWarning(warning: ScanWarning): DryRunWarning {
	const serialized: DryRunWarning = {
		message: warning.message,
		type: warning.type,
	}
	if ("path" in warning && typeof warning.path === "string") {
		serialized.path = warning.path
	}
	if ("field" in warning && typeof warning.field === "string") {
		serialized.field = warning.field
	}
	if ("source" in warning && typeof warning.source === "string") {
		serialized.source = warning.source
	}
	return serialized
}

function emitDryRunPayload(payload: DryRunPayload): void {
	process.stdout.write(`${JSON.stringify(payload)}\n`)
}

async function resetDryRunJobs(
	boss: PgBoss,
	table: string,
	jobIds: string[],
): Promise<void> {
	if (jobIds.length === 0) {
		return
	}
	const sql = `
		UPDATE ${PG_BOSS_SCHEMA}.${table}
		SET state = 'created',
			started_on = NULL,
			completed_on = NULL,
			retry_count = CASE WHEN retry_count > 0 THEN retry_count - 1 ELSE 0 END
		WHERE name = $1
			AND id = ANY($2::uuid[])
			AND state = 'active'
	`
	await boss.getDb().executeSql(sql, [DISCOVERY_QUEUE, jobIds])
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

async function processRepo(githubRepo: string): Promise<RepoProcessResult> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "sk-scan-"))
	const repoDir = path.join(tempDir, "repo")
	try {
		const cloneResult = await cloneRemoteRepo({
			destination: repoDir,
			remoteUrl: `https://github.com/${githubRepo}.git`,
		})
		if (!cloneResult.ok) {
			return {
				error: cloneResult.error,
				ok: false,
				retryable: false,
			}
		}

		const scanResult = await scanRepo(repoDir, githubRepo, {
			pluginTempRoot: path.join(tempDir, "plugins"),
		})
		if (!scanResult.ok) {
			return {
				error: scanResult.error,
				ok: false,
				retryable: false,
			}
		}

		const units = scanResult.value.units
		const warnings = scanResult.value.warnings
		if (units.length === 0) {
			return { ok: true, packages: [], retryable: false, warnings }
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
		const packages = units.flatMap((unit: ScanUnit) => {
			if (unit.skills.length === 0) {
				return []
			}

			const validated = coerceValidatedDeclaration(unit.declaration)
			if (!validated.ok) {
				warnings.push({
					...validated.error,
					path: unit.path ?? githubRepo,
				})
				return []
			}

			const name = unit.metadata?.name ?? repoName
			const description =
				unit.kind === "manifest"
					? (unit.metadata?.description ?? ghResult.value.description)
					: (unit.metadata?.description ?? null)

			const skills = unit.skills.map((skill) => ({
				description: skill.description ?? null,
				name: skill.name,
				relative_path: skill.relativePath,
			}))

			return [
				{
					package: {
						declaration: JSON.stringify(validated.value),
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
					},
					skills,
				},
			]
		})

		return { ok: true, packages, retryable: false, warnings }
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
