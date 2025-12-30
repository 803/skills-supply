import { intro, log, outro, spinner } from "@clack/prompts"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SKSUP_BASE_URL } from "@/env"
import { fetchWithRetry } from "@/utils/fetch"

interface MeResponse {
	username: string
}

export async function whoami(): Promise<void> {
	intro("sksup whoami")

	const creds = getStoredCredentials(SKSUP_BASE_URL)
	if (!creds) {
		process.exitCode = 1
		log.error("Not authenticated.")
		outro("Run `sksup auth` to authenticate.")
		return
	}

	const whoamiSpinner = spinner()
	whoamiSpinner.start("Checking identity...")

	let username = creds.username

	try {
		const response = await fetchWithRetry(`${SKSUP_BASE_URL}/api/me`, {
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

	whoamiSpinner.stop("Identity resolved.")
	outro(username)
}
