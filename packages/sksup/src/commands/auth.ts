import { configureCredentialHelper } from "../credentials/helper"
import { storeCredentials } from "../credentials/store"
import { SKSUP_BASE_URL } from "../env"
import { openBrowser } from "../utils/browser"
import { fetchWithRetry } from "../utils/fetch"
import { ensureGitAvailable } from "../utils/git"
import { sleep } from "../utils/sleep"

const MAX_POLL_ATTEMPTS = 150

interface DeviceSessionResponse {
	device_code: string
	user_code: string
	verification_url: string
	expires_in: number
	interval: number
}

interface TokenResponse {
	status: "pending" | "success" | "expired"
	token?: string
	user_id?: string
	username?: string
	email?: string
}

export async function auth(): Promise<void> {
	ensureGitAvailable()

	const session = await createDeviceSession()
	console.log("\nEnter this code in your browser:")
	console.log(`  ${session.user_code}\n`)
	console.log(`Open: ${session.verification_url}`)

	const opened = await openBrowser(session.verification_url)
	if (!opened) {
		console.log("Couldn't open browser automatically.")
		console.log(
			`Please visit this URL to authenticate:\n\n  ${session.verification_url}\n`,
		)
	}

	console.log("Waiting for authentication...")
	const result = await pollForToken(session.device_code, session.interval)

	if (!result) {
		console.error("Authentication timed out. Please try again.")
		process.exit(1)
	}

	configureCredentialHelper(SKSUP_BASE_URL)
	storeCredentials(SKSUP_BASE_URL, result.user_id, result.token)

	console.log(`\n✓ Authenticated as ${result.email}`)
	console.log("\nAdd your marketplace to Claude Code:")
	console.log(`  /plugin marketplace add ${SKSUP_BASE_URL}/me/marketplace\n`)
}

async function createDeviceSession(): Promise<DeviceSessionResponse> {
	const response = await fetchWithRetry(`${SKSUP_BASE_URL}/auth/cli`, {
		method: "POST",
	})

	if (!response.ok) {
		throw new Error("Failed to start authentication session")
	}

	return (await response.json()) as DeviceSessionResponse
}

async function pollForToken(
	deviceCode: string,
	intervalSeconds: number,
): Promise<Required<TokenResponse> | null> {
	const interval =
		Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 5
	const intervalMs = interval * 1000

	for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
		await sleep(intervalMs)

		let response: Response
		try {
			response = await fetchWithRetry(`${SKSUP_BASE_URL}/auth/cli/token`, {
				body: JSON.stringify({ device_code: deviceCode }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			})
		} catch {
			continue
		}

		if (!response.ok) {
			continue
		}

		const data = (await response.json()) as TokenResponse
		if (data.status === "success") {
			if (!data.token || !data.user_id || !data.email) {
				console.error("Authentication completed but missing token data.")
				process.exit(1)
			}

			return {
				email: data.email,
				status: data.status,
				token: data.token,
				user_id: data.user_id,
				username: data.username ?? data.user_id,
			}
		}

		if (data.status === "expired") {
			return null
		}

		process.stdout.write(".")
	}

	return null
}
