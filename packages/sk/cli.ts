#!/usr/bin/env node

import { Command } from "commander"
import { agentAdd } from "@/commands/agent/add"
import { agentInteractive } from "@/commands/agent/index"
import { agentRemove } from "@/commands/agent/remove"
import { auth } from "@/commands/auth"
import { initCommand } from "@/commands/init"
import { logout } from "@/commands/logout"
import { pkgAdd } from "@/commands/pkg/add"
import { pkgInteractive } from "@/commands/pkg/index"
import { pkgRemove } from "@/commands/pkg/remove"
import { status } from "@/commands/status"
import { syncCommand } from "@/commands/sync"
import { whoami } from "@/commands/whoami"
import pkg from "./package.json" with { type: "json" }

async function main(): Promise<void> {
	const program = new Command()

	program
		.name("sk")
		.description("Skills Supply CLI")
		.version(pkg.version, "-V, --version", "Output the version number")
		.showHelpAfterError()
		.showSuggestionAfterError()

	program
		.command("auth", { hidden: true })
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

	const pkgCmd = program
		.command("pkg")
		.description("Manage packages (interactive, add/remove)")

	pkgCmd
		.command("add")
		.description("Add a package")
		.argument("<typeOrUrl>", "Package type or URL")
		.argument("[spec]", "Package spec")
		.option("--tag <tag>", "Use a specific git tag")
		.option("--branch <branch>", "Use a specific git branch")
		.option("--rev <rev>", "Use a specific git commit")
		.option("--path <path>", "Use a subdirectory inside the repository")
		.option("--as <alias>", "Override the package alias")
		.option("--sync", "Run sync after updating the manifest")
		.option("--global", "Use the global manifest")
		.option("--non-interactive", "Run without prompts")
		.option("--init", "Create a manifest if one does not exist")
		.action(
			async (
				typeOrUrl: string,
				spec: string | undefined,
				options: {
					tag?: string
					branch?: string
					rev?: string
					path?: string
					as?: string
					sync?: boolean
					global?: boolean
					nonInteractive?: boolean
					init?: boolean
				},
			) => {
				await pkgAdd(typeOrUrl, spec, {
					as: options.as,
					branch: options.branch,
					global: Boolean(options.global),
					init: Boolean(options.init),
					nonInteractive: Boolean(options.nonInteractive),
					path: options.path,
					rev: options.rev,
					sync: Boolean(options.sync),
					tag: options.tag,
				})
			},
		)

	pkgCmd
		.command("remove")
		.description("Remove a package")
		.argument("<alias>", "Package alias")
		.option("--sync", "Run sync after updating the manifest")
		.option("--global", "Use the global manifest")
		.option("--non-interactive", "Run without prompts")
		.action(
			async (
				alias: string,
				options: { global?: boolean; nonInteractive?: boolean; sync?: boolean },
			) => {
				await pkgRemove(alias, {
					global: Boolean(options.global),
					nonInteractive: Boolean(options.nonInteractive),
					sync: Boolean(options.sync),
				})
			},
		)

	pkgCmd.action(async () => {
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
		.command("status", { hidden: true })
		.description("Show current auth status and account info")
		.action(async () => {
			await status()
		})

	program
		.command("logout", { hidden: true })
		.description("Remove credentials and deauthorize")
		.action(async () => {
			await logout()
		})

	program
		.command("whoami", { hidden: true })
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

void main()
