import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { getCredentialHelper } from "@/credentials/helper"

export function storeCredentials(baseUrl: string, username: string, token: string): void {
	const helper = getCredentialHelper()
	if (helper === "store") {
		storeCredentialsFile(baseUrl, username, token)
		return
	}

	storeCredentialsNative(baseUrl, username, token)
}

function storeCredentialsNative(baseUrl: string, username: string, token: string): void {
	const url = new URL(baseUrl)
	const proc = spawn("git", ["credential", "approve"], {
		stdio: ["pipe", "inherit", "inherit"],
	})

	proc.stdin.write(`protocol=${url.protocol.replace(":", "")}\n`)
	proc.stdin.write(`host=${url.host}\n`)
	proc.stdin.write(`username=${username}\n`)
	proc.stdin.write(`password=${token}\n`)
	proc.stdin.write("\n")
	proc.stdin.end()
}

function storeCredentialsFile(baseUrl: string, username: string, token: string): void {
	const url = new URL(baseUrl)
	const credentialsPath = path.join(os.homedir(), ".git-credentials")
	const credLine = `${url.protocol}//${username}:${token}@${url.host}`

	const existing = existsSync(credentialsPath)
		? readFileSync(credentialsPath, "utf8")
		: ""

	const filtered = existing
		.split("\n")
		.filter((line) => line && !line.includes(url.host))

	filtered.push(credLine)
	writeFileSync(credentialsPath, `${filtered.join("\n")}\n`, { mode: 0o600 })
}
