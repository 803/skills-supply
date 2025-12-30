import { intro, log, outro, spinner } from "@clack/prompts"
import { removeCredentials } from "@/credentials/remove"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SKSUP_BASE_URL } from "@/env"
import { formatError } from "@/utils/errors"
import { fetchWithRetry } from "@/utils/fetch"

export async function logout(): Promise<void> {
	intro("sksup logout")

	try {
		const creds = getStoredCredentials(SKSUP_BASE_URL)
		if (!creds) {
			log.info("Not authenticated.")
			outro("Nothing to do.")
			return
		}

		const logoutSpinner = spinner()
		logoutSpinner.start("Revoking credentials...")

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

		logoutSpinner.stop("Credentials removed.")
		outro("Logged out successfully.")
	} catch (error) {
		process.exitCode = 1
		log.error(formatError(error))
		outro("Failed to log out.")
	}
}
