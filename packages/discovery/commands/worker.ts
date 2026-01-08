import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { coerceValidatedDeclaration } from "@skills-supply/core"
import { consola } from "consola"
import type { Job } from "pg-boss"
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
}

type RepoProcessResult =
	| {
			ok: true
			retryable: false
			packages: IndexedPackageInsertWithSkills[]
			warnings: ScanWarning[]
	  }
	| { ok: false; retryable: boolean; error: DiscoveryError }

export async function workerCommand(options: WorkerOptions): Promise<void> {
	const boss = await createBoss()
	const maxJobs = options.limit
	let processed = 0
	let stopPromise: Promise<void> | null = null

	consola.success("Discovery worker running.")

	const requestStop = async (messageOverride?: string): Promise<void> => {
		if (stopPromise) {
			return stopPromise
		}
		const message =
			messageOverride ??
			(typeof maxJobs === "number"
				? `Limit reached (${maxJobs}). Stopping discovery worker...`
				: "Stopping discovery worker...")
		consola.info(message)
		stopPromise = (async () => {
			await boss.offWork(DISCOVERY_QUEUE, { wait: true })
			await boss.stop()
			await db.destroy()
			process.exit(0)
		})()
		return stopPromise
	}

	process.on("SIGINT", () => {
		void requestStop("Stopping discovery worker...")
	})

	const workerCount =
		typeof maxJobs === "number"
			? Math.min(options.concurrency, maxJobs)
			: options.concurrency

	const handleJobs = async (jobs: Job<{ github_repo?: string }>[]): Promise<void> => {
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
			printRawErrorChain(result.error)
			throw new Error(message)
		}

		console.log(
			"about to persist",
			result.packages.length,
			"packages for",
			githubRepo,
		)
		await persistRepoPackages(githubRepo, result.packages)
	}

	await Promise.all(
		Array.from({ length: workerCount }, () =>
			boss.work(DISCOVERY_QUEUE, { batchSize: 1 }, handleJobs),
		),
	)
}

async function persistRepoPackages(
	githubRepo: string,
	packages: IndexedPackageInsertWithSkills[],
): Promise<void> {
	if (packages.length === 0) {
		await upsertRepoPackages(db, githubRepo, [])
		consola.info(`${githubRepo}: no installable packages found.`)
		return
	}
	await upsertRepoPackages(db, githubRepo, packages)
	consola.success(`${githubRepo}: indexed ${packages.length} packages.`)
}

async function processRepo(githubRepo: string): Promise<RepoProcessResult> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "sk-scan-"))
	const repoDir = path.join(tempDir, "repo")
	consola.info(`${githubRepo}: processing`)
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

		console.log(units)

		if (units.length === 0) {
			return { ok: true, packages: [], retryable: false, warnings }
		}

		const ghResult = await fetchGithubRepoMetadata(githubRepo)
		if (!ghResult.ok) {
			// @ts-expect-error
			throw new Error(ghResult.error)
		}

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

			const name = unit.metadata?.name ?? null
			const description = unit.metadata?.description ?? null

			const skills = unit.skills.map((skill) => ({
				description: skill.description ?? null,
				name: skill.name,
				relative_path: skill.relativePath,
			}))

			return [
				{
					package: {
						declaration: JSON.stringify(validated.value),
						description: description,
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

		console.log("final packages count", packages.length)
		return { ok: true, packages, retryable: false, warnings }
	} finally {
		await rm(tempDir, { force: true, recursive: true })
	}
}
