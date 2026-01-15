import { coerceGithubRef, type Result } from "@skills-supply/core"
import { consola } from "consola"
import { DraftOptionsSchema, draftCommand } from "@/commands/draft"
import { printError } from "@/commands/outcome"
import { persistRepoPackages, processRepo } from "@/commands/worker"
import { db } from "@/db"
import type { DiscoveryError } from "@/types/errors"

interface ProcessOptions {
	repo: string
	mode?: string
	maxStars?: string
}

export async function processCommand(
	options: ProcessOptions,
): Promise<Result<void, DiscoveryError>> {
	const githubRef = coerceGithubRef(options.repo)
	if (!githubRef) {
		return {
			error: {
				field: "repo",
				message: `Invalid GitHub repo format: ${options.repo}. Expected owner/repo`,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	consola.info(`Processing ${githubRef}...`)

	// Process and persist - handle cleanup on early exit or error
	let packageIds: number[]
	try {
		const result = await processRepo(githubRef)
		if (!result.ok) {
			await db.destroy()
			return result
		}
		packageIds = await persistRepoPackages(githubRef, result.packages)
	} catch (error) {
		await db.destroy()
		throw error
	}

	if (packageIds.length === 0) {
		await db.destroy()
		consola.info("No packages found. Skipping draft.")
		return { ok: true, value: undefined }
	}

	consola.info(`Found ${packageIds.length} package(s). Starting draft...`)

	const draftOptions = DraftOptionsSchema.safeParse({
		id: packageIds[0],
		maxStars: options.maxStars,
		mode: options.mode,
	})

	if (!draftOptions.success) {
		await db.destroy()
		printError({
			field: "options",
			message: draftOptions.error.message,
			source: "zod",
			type: "validation",
			zodError: draftOptions.error,
		})
		return {
			error: {
				field: "options",
				message: draftOptions.error.message,
				source: "zod",
				type: "validation",
				zodError: draftOptions.error,
			},
			ok: false,
		}
	}

	// draftCommand handles db cleanup in its own finally block
	return await draftCommand(draftOptions.data)
}
