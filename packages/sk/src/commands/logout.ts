import { consola } from "consola"
import { removeCredentials } from "@/credentials/remove"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SK_BASE_URL } from "@/env"
import { formatError } from "@/utils/errors"
import { fetchWithRetry } from "@/utils/fetch"

export async function logout(): Promise<void> {
	consola.info("sk logout")

	try {
		const creds = getStoredCredentials(SK_BASE_URL)
		if (!creds) {
			consola.info("Not authenticated.")
			consola.info("Nothing to do.")
			return
		}

		consola.start("Revoking credentials...")

		removeCredentials(SK_BASE_URL)

		try {
			await fetchWithRetry(`${SK_BASE_URL}/api/tokens/revoke`, {
				headers: {
					Authorization: `Bearer ${creds.token}`,
				},
				method: "POST",
			})
		} catch {
			// Best effort
		}

		consola.success("Credentials removed.")
		consola.success("Logged out successfully.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Failed to log out.")
	}
}
