import { getStoredCredentials } from "../credentials/retrieve"
import { SKSUP_BASE_URL } from "../env"
import { fetchWithRetry } from "../utils/fetch"

interface MeResponse {
	username: string
}

export async function whoami(): Promise<void> {
	const creds = getStoredCredentials(SKSUP_BASE_URL)
	if (!creds) {
		console.log("Not authenticated.")
		process.exit(1)
	}

	try {
		const response = await fetchWithRetry(`${SKSUP_BASE_URL}/api/me`, {
			headers: {
				Authorization: `Bearer ${creds.token}`,
			},
		})

		if (response.ok) {
			const user = (await response.json()) as MeResponse
			console.log(user.username)
			return
		}
	} catch {
		// Fall back to stored username
	}

	console.log(creds.username)
}
