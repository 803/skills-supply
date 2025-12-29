import { removeCredentials } from "../credentials/remove"
import { getStoredCredentials } from "../credentials/retrieve"
import { SKSUP_BASE_URL } from "../env"
import { fetchWithRetry } from "../utils/fetch"

export async function logout(): Promise<void> {
	const creds = getStoredCredentials(SKSUP_BASE_URL)
	if (!creds) {
		console.log("Not authenticated.")
		return
	}

	removeCredentials(SKSUP_BASE_URL)

	try {
		await fetchWithRetry(`${SKSUP_BASE_URL}/api/tokens/revoke`, {
			headers: {
				Authorization: `Bearer ${creds.token}`,
			},
			method: "POST",
		})
	} catch {
		// Best effort
	}

	console.log("Logged out successfully.")
}
