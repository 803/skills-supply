#!/usr/bin/env node

import { Command } from "commander"
import { draftCommand } from "@/commands/draft"
import { enqueueCommand } from "@/commands/enqueue"
import { listCommand } from "@/commands/list"
import { printError } from "@/commands/outcome"
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

	program
		.command("draft")
		.description("Generate README install text for a package")
		.argument("<id>", "Package id")
		.action(async (id: string) => {
			const parsed = Number.parseInt(id, 10)
			if (!Number.isFinite(parsed)) {
				printError({
					field: "id",
					message: "Package id must be a number.",
					source: "manual",
					type: "validation",
				})
				return
			}
			const result = await draftCommand(parsed)
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
