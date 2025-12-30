import { execSync } from "node:child_process"

export function ensureGitAvailable(): void {
	try {
		execSync("git --version", { stdio: "ignore" })
	} catch {
		throw new Error("git is not installed or not in PATH")
	}
}
