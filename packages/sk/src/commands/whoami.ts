import { consola } from "consola"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SK_BASE_URL } from "@/env"
import { fetchWithRetry } from "@/utils/fetch"

interface MeResponse {
	username: string
}

export async function whoami(): Promise<void> {
	consola.info("sk whoami")

	const creds = getStoredCredentials(SK_BASE_URL)
	if (!creds) {
		process.exitCode = 1
		consola.error("Not authenticated.")
		consola.info("Run `sk auth` to authenticate.")
		return
	}

	consola.start("Checking identity...")

	let username = creds.username

	try {
		const response = await fetchWithRetry(`${SK_BASE_URL}/api/me`, {
			headers: {
				Authorization: `Bearer ${creds.token}`,
			},
		})

		if (response.ok) {
			const user = (await response.json()) as MeResponse
			username = user.username
		}
	} catch {
		// Fall back to stored username
	}

	consola.success("Identity resolved.")
	consola.info(username)
}
