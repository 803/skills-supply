import { execSync } from "node:child_process"

export interface StoredCredentials {
	username: string
	token: string
}

export function getStoredCredentials(baseUrl: string): StoredCredentials | null {
	const url = new URL(baseUrl)
	try {
		const output = execSync("git credential fill", {
			encoding: "utf8",
			input: `protocol=${url.protocol.replace(":", "")}\nhost=${url.host}\n\n`,
		})

		const lines = output.split("\n")
		let username = ""
		let token = ""

		for (const line of lines) {
			if (line.startsWith("username=")) {
				username = line.slice("username=".length)
			}
			if (line.startsWith("password=")) {
				token = line.slice("password=".length)
			}
		}

		if (username && token) {
			return { token, username }
		}
	} catch {
		return null
	}

	return null
}
