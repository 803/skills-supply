import { consola } from "consola"
import { getStoredCredentials } from "@/src/credentials/retrieve"
import { SK_BASE_URL } from "@/src/env"
import { formatError } from "@/src/utils/errors"
import { fetchWithRetry } from "@/src/utils/fetch"

interface MeResponse {
	email: string
	username: string
}

export async function status(): Promise<void> {
	consola.info("sk status")

	const creds = getStoredCredentials(SK_BASE_URL)
	if (!creds) {
		consola.info("Not authenticated.")
		consola.info("Run `sk auth` to authenticate.")
		return
	}

	consola.start("Checking account...")

	try {
		const response = await fetchWithRetry(`${SK_BASE_URL}/api/me`, {
			headers: {
				Authorization: `Bearer ${creds.token}`,
			},
		})

		if (!response.ok) {
			consola.warn("Token is invalid or expired.")
			consola.info("Run `sk auth` to re-authenticate.")
			return
		}

		const user = (await response.json()) as MeResponse
		consola.success("Account info loaded.")

		consola.info(
			`Account\nEmail: ${user.email}\nUsername: ${user.username}\nMarketplace: ${SK_BASE_URL}/me/marketplace`,
		)
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Status check failed.")
	}
}
