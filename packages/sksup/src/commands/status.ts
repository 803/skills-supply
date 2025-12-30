import { intro, log, note, outro, spinner } from "@clack/prompts"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SKSUP_BASE_URL } from "@/env"
import { formatError } from "@/utils/errors"
import { fetchWithRetry } from "@/utils/fetch"

interface MeResponse {
	email: string
	username: string
}

export async function status(): Promise<void> {
	intro("sksup status")

	const creds = getStoredCredentials(SKSUP_BASE_URL)
	if (!creds) {
		log.info("Not authenticated.")
		outro("Run `sksup auth` to authenticate.")
		return
	}

	const statusSpinner = spinner()
	statusSpinner.start("Checking account...")

	try {
		const response = await fetchWithRetry(`${SKSUP_BASE_URL}/api/me`, {
			headers: {
				Authorization: `Bearer ${creds.token}`,
			},
		})

		if (!response.ok) {
			statusSpinner.stop("Token invalid or expired.")
			log.warn("Token is invalid or expired.")
			outro("Run `sksup auth` to re-authenticate.")
			return
		}

		const user = (await response.json()) as MeResponse
		statusSpinner.stop("Account info loaded.")

		note(
			`Email: ${user.email}\nUsername: ${user.username}\nMarketplace: ${SKSUP_BASE_URL}/me/marketplace`,
			"Account",
		)
		outro("Done.")
	} catch (error) {
		statusSpinner.stop("Failed to fetch account info.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Status check failed.")
	}
}
