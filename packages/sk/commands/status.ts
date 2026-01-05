import { consola } from "consola"
import { CommandResult, printOutcome } from "@/commands/types"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SK_BASE_URL } from "@/env"
import { fetchWithRetry } from "@/utils/fetch"

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

	let response: Response
	try {
		response = await fetchWithRetry(`${SK_BASE_URL}/api/me`, {
			headers: {
				Authorization: `Bearer ${creds.token}`,
			},
		})
	} catch (error) {
		printOutcome(
			CommandResult.failed({
				message: "Status check failed.",
				rawError: error instanceof Error ? error : undefined,
				source: `${SK_BASE_URL}/api/me`,
				type: "network",
			}),
		)
		return
	}

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
}
