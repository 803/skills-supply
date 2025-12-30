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

	cli.command("pkg", "Manage packages interactively").action(async () => {
		await pkgInteractive()
	})

	cli.command("pkg add <type> <spec>", "Add a package to skills.toml")
		.option("--tag <tag>", "Use a specific git tag")
		.option("--branch <branch>", "Use a specific git branch")
		.option("--rev <rev>", "Use a specific git commit")
		.option("--path <path>", "Use a subdirectory inside the repository")
		.option("--as <alias>", "Override the package alias")
		.action(async (type, spec, options) => {
			await pkgAdd(type, spec, {
				as: options.as,
				branch: options.branch,
				path: options.path,
				rev: options.rev,
				tag: options.tag,
			})
		})

	cli.command("pkg remove <alias>", "Remove a package from skills.toml").action(
		async (alias) => {
			await pkgRemove(alias)
		},
	)

	cli.command("agent", "Manage agents interactively").action(async () => {
		await agentInteractive()
	})

	cli.command("agent add <name>", "Enable an agent").action(async (name) => {
		await agentAdd(name)
	})

	cli.command("agent remove <name>", "Disable an agent").action(async (name) => {
		await agentRemove(name)
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
		const unknown = cli.args.length > 0 ? cli.args.join(" ") : "unknown"
		console.error(`Unknown command: ${unknown}`)
		cli.outputHelp()
		process.exit(1)
	})

	cli.help()
	const parsed = cli.parse()

	if (parsed.args.length === 0 && !parsed.options.help && !parsed.options.h) {
		cli.outputHelp()
	}
}

main().catch((error) => {
	console.error("Error:", error instanceof Error ? error.message : error)
	process.exit(1)
})
