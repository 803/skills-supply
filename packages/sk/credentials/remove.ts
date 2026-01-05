import { spawn } from "node:child_process"

export function removeCredentials(baseUrl: string): void {
	const url = new URL(baseUrl)
	const proc = spawn("git", ["credential", "reject"], {
		stdio: ["pipe", "inherit", "inherit"],
	})

	proc.stdin.write(`protocol=${url.protocol.replace(":", "")}\n`)
	proc.stdin.write(`host=${url.host}\n`)
	proc.stdin.write("\n")
	proc.stdin.end()
}
