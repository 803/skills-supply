#!/usr/bin/env node

import { cac } from "cac"
import { agentAdd } from "@/commands/agent/add"
import { agentInteractive } from "@/commands/agent/index"
import { agentRemove } from "@/commands/agent/remove"
import { auth } from "@/commands/auth"
import { logout } from "@/commands/logout"
import { pkgAdd } from "@/commands/pkg/add"
import { pkgInteractive } from "@/commands/pkg/index"
import { pkgRemove } from "@/commands/pkg/remove"
import { status } from "@/commands/status"
import { syncCommand } from "@/commands/sync"
import { whoami } from "@/commands/whoami"

async function main(): Promise<void> {
	const cli = cac("sksup")

	cli.command("auth", "Authenticate and configure git credentials").action(async () => {
		await auth()
	})

	cli.command("sync", "Sync skills across agents")
		.option("--dry-run", "Plan changes without modifying files")
		.action(async (options) => {
			await syncCommand({ dryRun: Boolean(options.dryRun) })
		})

	cli.command("pkg [subcommand] [...args]", "Manage packages (interactive, add/remove)")
		.option("--tag <tag>", "Use a specific git tag")
		.option("--branch <branch>", "Use a specific git branch")
		.option("--rev <rev>", "Use a specific git commit")
		.option("--path <path>", "Use a subdirectory inside the repository")
		.option("--as <alias>", "Override the package alias")
		.action(async (subcommand, args, options) => {
			const command = normalizeSubcommand(subcommand)
			const rest = Array.isArray(args) ? args : []

			if (!command || command === "interactive") {
				await pkgInteractive()
				return
			}

			if (command === "add") {
				const [type, spec] = rest
				if (!type || !spec) {
					failSubcommand("pkg", "add", "pkg add <type> <spec>")
					return
				}

				await pkgAdd(type, spec, {
					as: options.as,
					branch: options.branch,
					path: options.path,
					rev: options.rev,
					tag: options.tag,
				})
				return
			}

			if (command === "remove") {
				const [alias] = rest
				if (!alias) {
					failSubcommand("pkg", "remove", "pkg remove <alias>")
					return
				}

				await pkgRemove(alias)
				return
			}

			failUnknownSubcommand("pkg", command, "add, remove")
		})

	cli.command(
		"agent [subcommand] [...args]",
		"Manage agents (interactive, add/remove)",
	).action(async (subcommand, args) => {
		const command = normalizeSubcommand(subcommand)
		const rest = Array.isArray(args) ? args : []

		if (!command || command === "interactive") {
			await agentInteractive()
			return
		}

		if (command === "add") {
			const [name] = rest
			if (!name) {
				failSubcommand("agent", "add", "agent add <name>")
				return
			}

			await agentAdd(name)
			return
		}

		if (command === "remove") {
			const [name] = rest
			if (!name) {
				failSubcommand("agent", "remove", "agent remove <name>")
				return
			}

			await agentRemove(name)
			return
		}

		failUnknownSubcommand("agent", command, "add, remove")
	})

	cli.command("status", "Show current auth status and account info").action(
		async () => {
			await status()
		},
	)

	cli.command("logout", "Remove credentials and deauthorize").action(async () => {
		await logout()
	})

	cli.command("whoami", "Show current username").action(async () => {
		await whoami()
	})

	cli.on("command:*", () => {
		if (cli.options.help) {
			return
		}
		const unknown = cli.args.length > 0 ? cli.args.join(" ") : "unknown"
		console.error(`Unknown command: ${unknown}`)
		cli.outputHelp()
		process.exit(1)
	})

	cli.help()
	const parsed = cli.parse()

	if (
		!cli.matchedCommand &&
		parsed.args.length === 0 &&
		!parsed.options.help &&
		!parsed.options.h
	) {
		cli.outputHelp()
	}
}

main().catch((error) => {
	console.error("Error:", error instanceof Error ? error.message : error)
	process.exit(1)
})

function normalizeSubcommand(value: unknown): string {
	if (typeof value !== "string") {
		return ""
	}

	return value.trim().toLowerCase()
}

function failSubcommand(primary: string, subcommand: string, usage: string): void {
	console.error(`Missing arguments for ${primary} ${subcommand}.`)
	console.error(`Usage: sksup ${usage}`)
	process.exitCode = 1
}

function failUnknownSubcommand(
	primary: string,
	subcommand: string,
	expected: string,
): void {
	console.error(`Unknown ${primary} subcommand: ${subcommand}`)
	console.error(`Expected one of: ${expected}`)
	process.exitCode = 1
}
