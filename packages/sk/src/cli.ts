#!/usr/bin/env node

import { Command } from "commander"
import { consola } from "consola"
import { agentAdd } from "@/src/commands/agent/add"
import { agentInteractive } from "@/src/commands/agent/index"
import { agentRemove } from "@/src/commands/agent/remove"
import { auth } from "@/src/commands/auth"
import { logout } from "@/src/commands/logout"
import { pkgAdd } from "@/src/commands/pkg/add"
import { pkgInteractive } from "@/src/commands/pkg/index"
import { pkgRemove } from "@/src/commands/pkg/remove"
import { status } from "@/src/commands/status"
import { syncCommand } from "@/src/commands/sync"
import { whoami } from "@/src/commands/whoami"

async function main(): Promise<void> {
	const program = new Command()

	program
		.name("sk")
		.description("Skills Supply CLI")
		.showHelpAfterError()
		.showSuggestionAfterError()

	program
		.command("auth")
		.description("Authenticate and configure git credentials")
		.action(async () => {
			await auth()
		})

	program
		.command("sync")
		.description("Sync skills across agents")
		.option("--dry-run", "Plan changes without modifying files")
		.action(async (options: { dryRun?: boolean }) => {
			await syncCommand({ dryRun: Boolean(options.dryRun) })
		})

	const pkg = program
		.command("pkg")
		.description("Manage packages (interactive, add/remove)")

	pkg.command("add")
		.description("Add a package")
		.argument("<type>", "Package type")
		.argument("<spec>", "Package spec")
		.option("--tag <tag>", "Use a specific git tag")
		.option("--branch <branch>", "Use a specific git branch")
		.option("--rev <rev>", "Use a specific git commit")
		.option("--path <path>", "Use a subdirectory inside the repository")
		.option("--as <alias>", "Override the package alias")
		.action(
			async (
				type: string,
				spec: string,
				options: {
					tag?: string
					branch?: string
					rev?: string
					path?: string
					as?: string
				},
			) => {
				await pkgAdd(type, spec, {
					as: options.as,
					branch: options.branch,
					path: options.path,
					rev: options.rev,
					tag: options.tag,
				})
			},
		)

	pkg.command("remove")
		.description("Remove a package")
		.argument("<alias>", "Package alias")
		.action(async (alias: string) => {
			await pkgRemove(alias)
		})

	pkg.action(async () => {
		await pkgInteractive()
	})

	const agent = program
		.command("agent")
		.description("Manage agents (interactive, add/remove)")

	agent
		.command("add")
		.description("Enable an agent")
		.argument("<name>", "Agent id")
		.action(async (name: string) => {
			await agentAdd(name)
		})

	agent
		.command("remove")
		.description("Disable an agent")
		.argument("<name>", "Agent id")
		.action(async (name: string) => {
			await agentRemove(name)
		})

	agent.action(async () => {
		await agentInteractive()
	})

	program
		.command("status")
		.description("Show current auth status and account info")
		.action(async () => {
			await status()
		})

	program
		.command("logout")
		.description("Remove credentials and deauthorize")
		.action(async () => {
			await logout()
		})

	program
		.command("whoami")
		.description("Show current username")
		.action(async () => {
			await whoami()
		})

	if (process.argv.length <= 2) {
		program.outputHelp()
		return
	}

	await program.parseAsync(process.argv)
}

main().catch((error) => {
	consola.error(error instanceof Error ? error.message : error)
	process.exit(1)
})
