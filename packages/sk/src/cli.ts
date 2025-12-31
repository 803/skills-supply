#!/usr/bin/env node

import { Command } from "commander"
import { consola } from "consola"
import { agentAdd } from "@/src/commands/agent/add"
import { agentInteractive } from "@/src/commands/agent/index"
import { agentRemove } from "@/src/commands/agent/remove"
import { auth } from "@/src/commands/auth"
import { initCommand } from "@/src/commands/init"
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
		.option("--global", "Use the global manifest")
		.option("--non-interactive", "Run without prompts")
		.action(
			async (options: {
				dryRun?: boolean
				global?: boolean
				nonInteractive?: boolean
			}) => {
				await syncCommand({
					dryRun: Boolean(options.dryRun),
					global: Boolean(options.global),
					nonInteractive: Boolean(options.nonInteractive),
				})
			},
		)

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
		.option("--global", "Use the global manifest")
		.option("--non-interactive", "Run without prompts")
		.option("--init", "Create a manifest if one does not exist")
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
					global?: boolean
					nonInteractive?: boolean
					init?: boolean
				},
			) => {
				await pkgAdd(type, spec, {
					as: options.as,
					branch: options.branch,
					global: Boolean(options.global),
					init: Boolean(options.init),
					nonInteractive: Boolean(options.nonInteractive),
					path: options.path,
					rev: options.rev,
					tag: options.tag,
				})
			},
		)

	pkg.command("remove")
		.description("Remove a package")
		.argument("<alias>", "Package alias")
		.option("--global", "Use the global manifest")
		.option("--non-interactive", "Run without prompts")
		.action(
			async (
				alias: string,
				options: { global?: boolean; nonInteractive?: boolean },
			) => {
				await pkgRemove(alias, {
					global: Boolean(options.global),
					nonInteractive: Boolean(options.nonInteractive),
				})
			},
		)

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
		.option("--global", "Use the global manifest")
		.option("--non-interactive", "Run without prompts")
		.action(
			async (
				name: string,
				options: { global?: boolean; nonInteractive?: boolean },
			) => {
				await agentAdd(name, {
					global: Boolean(options.global),
					nonInteractive: Boolean(options.nonInteractive),
				})
			},
		)

	agent
		.command("remove")
		.description("Disable an agent")
		.argument("<name>", "Agent id")
		.option("--global", "Use the global manifest")
		.option("--non-interactive", "Run without prompts")
		.action(
			async (
				name: string,
				options: { global?: boolean; nonInteractive?: boolean },
			) => {
				await agentRemove(name, {
					global: Boolean(options.global),
					nonInteractive: Boolean(options.nonInteractive),
				})
			},
		)

	agent.action(async () => {
		await agentInteractive()
	})

	program
		.command("init")
		.description("Initialize an agents.toml manifest")
		.option("--global", "Create a global manifest")
		.option("--non-interactive", "Run without prompts")
		.option("--agents <agents>", "Comma-separated list of agent ids")
		.action(
			async (options: {
				global?: boolean
				nonInteractive?: boolean
				agents?: string
			}) => {
				await initCommand({
					agents: options.agents,
					global: Boolean(options.global),
					nonInteractive: Boolean(options.nonInteractive),
				})
			},
		)

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
