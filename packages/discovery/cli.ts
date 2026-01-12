#!/usr/bin/env node

import { Command } from "commander"
import { z } from "zod"
import { cleanForksCommand } from "@/commands/clean-forks"
import { draftCommand } from "@/commands/draft"
import { enqueueCommand } from "@/commands/enqueue"
import { listCommand } from "@/commands/list"
import { printError } from "@/commands/outcome"
import { randomCommand } from "@/commands/random"
import { updateDraftsCommand } from "@/commands/update-drafts"
import { workerCommand } from "@/commands/worker"

async function main(): Promise<void> {
	const program = new Command()

	program
		.name("sk-discovery")
		.description("Skills directory discovery tooling")
		.showHelpAfterError()
		.showSuggestionAfterError()

	program
		.command("enqueue")
		.description("Enqueue repos from a discovery source")
		.argument("[source]", "Discovery source (skillsmp-bql | skillsmp-api)")
		.option("--new", "Only enqueue repos not already indexed")
		.option("--clear", "Clear the queue and exit")
		.action(
			async (
				source: string | undefined,
				options: { new?: boolean; clear?: boolean },
			) => {
				const result = await enqueueCommand(source, {
					clear: Boolean(options.clear),
					newOnly: Boolean(options.new),
				})
				if (!result.ok) {
					printError(result.error)
				}
			},
		)

	program
		.command("worker")
		.description("Process queued discovery jobs")
		.option("--concurrency <count>", "Jobs per worker", "5")
		.option("--limit <count>", "Stop after processing N repos")
		.action(async (options: { concurrency: string; limit?: string }) => {
			const count = Number.parseInt(options.concurrency, 10)
			if (!Number.isFinite(count) || count <= 0) {
				printError({
					field: "concurrency",
					message: "--concurrency must be a positive integer.",
					source: "manual",
					type: "validation",
				})
				return
			}
			const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined
			if (typeof limit === "number" && (!Number.isFinite(limit) || limit <= 0)) {
				printError({
					field: "limit",
					message: "--limit must be a positive integer.",
					source: "manual",
					type: "validation",
				})
				return
			}
			await workerCommand({
				concurrency: count,
				limit,
			})
		})

	program
		.command("list")
		.description("List indexed packages")
		.option("--stars <count>", "Minimum GitHub stars")
		.action(async (options: { stars?: string }) => {
			let minStars: number | undefined
			if (options.stars !== undefined) {
				const parsed = Number.parseInt(options.stars, 10)
				if (!Number.isFinite(parsed) || parsed < 0) {
					printError({
						field: "stars",
						message: "--stars must be a positive integer.",
						source: "manual",
						type: "validation",
					})
					return
				}
				minStars = parsed
			}
			const result = await listCommand({ minStars })
			if (!result.ok) {
				printError(result.error)
			}
		})

	const DraftOptionsSchema = z.object({
		id: z.coerce.number().int().positive().optional(),
		maxStars: z.coerce.number().int().nonnegative().optional(),
		mode: z.enum(["link", "submit"]).default("link"),
	})

	program
		.command("draft")
		.description("Create a PR to add sk installation instructions")
		.argument("[id]", "Package id (optional)")
		.option(
			"--mode <mode>",
			"link (default): print PR link | submit: create PR via API",
		)
		.option("--max-stars <count>", "Only consider repos with at most this many stars")
		.action(
			async (
				id: string | undefined,
				options: { mode?: string; maxStars?: string },
			) => {
				const parsed = DraftOptionsSchema.safeParse({ ...options, id })
				if (!parsed.success) {
					printError({
						field: "options",
						message: parsed.error.message,
						source: "zod",
						type: "validation",
						zodError: parsed.error,
					})
					return
				}

				const result = await draftCommand(parsed.data)
				if (!result.ok) {
					printError(result.error)
				}
			},
		)

	program
		.command("random")
		.description("Output sk install command for a random package")
		.action(async () => {
			const result = await randomCommand()
			if (!result.ok) {
				printError(result.error)
			}
		})

	program
		.command("clean-forks")
		.description("Delete orphan forks from the 803 org")
		.action(async () => {
			const result = await cleanForksCommand()
			if (!result.ok) {
				printError(result.error)
			}
		})

	program
		.command("update-drafts")
		.description("Iterate through open PRs and refine with Claude")
		.action(async () => {
			const result = await updateDraftsCommand()
			if (!result.ok) {
				printError(result.error)
			}
		})

	if (process.argv.length <= 2) {
		program.outputHelp()
		return
	}

	await program.parseAsync(process.argv)
}

void main()
