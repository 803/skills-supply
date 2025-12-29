import { execSync } from "node:child_process"

export function getCredentialHelper(): string {
	switch (process.platform) {
		case "darwin":
			return "osxkeychain"
		case "win32":
			return "manager-core"
		default:
			return "store"
	}
}

export function configureCredentialHelper(baseUrl: string): void {
	const helper = getCredentialHelper()
	const resolvedHelper = helper === "manager-core" ? resolveWindowsHelper() : helper

	execSync(`git config --global credential.${baseUrl}.helper ${resolvedHelper}`)
}

function resolveWindowsHelper(): string {
	try {
		execSync("git credential-manager-core --version", { stdio: "ignore" })
		return "manager-core"
	} catch {
		console.warn(
			"Git Credential Manager not found; falling back to plaintext credential store.",
		)
		return "store"
	}
}
