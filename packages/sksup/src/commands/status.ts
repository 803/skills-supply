import { getStoredCredentials } from "../credentials/retrieve"
import { SKSUP_BASE_URL } from "../env"
import { fetchWithRetry } from "../utils/fetch"

interface MeResponse {
	email: string
	username: string
}

export async function status(): Promise<void> {
	const creds = getStoredCredentials(SKSUP_BASE_URL)
	if (!creds) {
		console.log("Not authenticated.")
		console.log("Run `sksup auth` to authenticate.")
		return
	}

	try {
		const response = await fetchWithRetry(`${SKSUP_BASE_URL}/api/me`, {
			headers: {
				Authorization: `Bearer ${creds.token}`,
			},
		})

		if (!response.ok) {
			console.log("Token is invalid or expired.")
			console.log("Run `sksup auth` to re-authenticate.")
			return
		}

		const user = (await response.json()) as MeResponse
		console.log(`Logged in as: ${user.email}`)
		console.log(`Username: ${user.username}`)
		console.log(`Marketplace: ${SKSUP_BASE_URL}/me/marketplace`)
	} catch (error) {
		console.error("Failed to fetch account info:", error)
	}
}
