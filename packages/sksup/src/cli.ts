#!/usr/bin/env node

import { auth } from "./commands/auth"
import { logout } from "./commands/logout"
import { status } from "./commands/status"
import { whoami } from "./commands/whoami"

const command = process.argv[2]

async function main(): Promise<void> {
	switch (command) {
		case "auth":
			await auth()
			return
		case "status":
			await status()
			return
		case "logout":
			await logout()
			return
		case "whoami":
			await whoami()
			return
		case "--help":
		case "-h":
		case undefined:
			printHelp()
			return
		default:
			console.error(`Unknown command: ${command}`)
			printHelp()
			process.exit(1)
	}
}

function printHelp(): void {
	console.log(`
SKSUP - Skills Supply CLI

Usage:
  sksup <command>

Commands:
  auth      Authenticate and configure git credentials
  status    Show current auth status and account info
  logout    Remove credentials and deauthorize
  whoami    Show current username

Examples:
  sksup auth
  sksup status
  sksup logout
`)
}

main().catch((error) => {
	console.error("Error:", error instanceof Error ? error.message : error)
	process.exit(1)
})
