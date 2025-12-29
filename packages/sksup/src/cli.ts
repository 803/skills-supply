#!/usr/bin/env node

import { cac } from "cac"
import { auth } from "@/commands/auth"
import { logout } from "@/commands/logout"
import { status } from "@/commands/status"
import { whoami } from "@/commands/whoami"

async function main(): Promise<void> {
	const cli = cac("sksup")

	cli.command("auth", "Authenticate and configure git credentials").action(async () => {
		await auth()
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
