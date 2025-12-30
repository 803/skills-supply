import { intro, log, note, outro, spinner } from "@clack/prompts"
import { configureCredentialHelper } from "@/credentials/helper"
import { storeCredentials } from "@/credentials/store"
import { SKSUP_BASE_URL } from "@/env"
import { openBrowser } from "@/utils/browser"
import { formatError } from "@/utils/errors"
import { fetchWithRetry } from "@/utils/fetch"
import { ensureGitAvailable } from "@/utils/git"
import { sleep } from "@/utils/sleep"

const MAX_POLL_ATTEMPTS = 150

type AuthPhase = "starting" | "waiting" | "timeout" | "success" | "error"

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

interface AuthState {
	phase: AuthPhase
	session?: DeviceSessionResponse
	email?: string
}

export async function auth(): Promise<void> {
	intro("sksup auth")

	try {
		ensureGitAvailable()
	} catch (error) {
		process.exitCode = 1
		log.error(formatError(error))
		outro("Authentication failed.")
		return
	}

	const sessionSpinner = spinner()
	sessionSpinner.start("Starting authentication...")

	let state: AuthState = { phase: "starting" }
	try {
		const session = await createDeviceSession()
		state = { phase: "waiting", session }
		sessionSpinner.stop("Device session created.")
	} catch (error) {
		sessionSpinner.stop("Failed to start authentication.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Authentication failed.")
		return
	}

	if (!state.session) {
		process.exitCode = 1
		log.error("Authentication session missing.")
		outro("Authentication failed.")
		return
	}

	note(
		`Code: ${state.session.user_code}\nOpen: ${state.session.verification_url}`,
		"Authenticate",
	)

	let opened = false
	try {
		opened = await openBrowser(state.session.verification_url)
	} catch {
		opened = false
	}

	if (!opened) {
		log.warn("Couldn't open browser automatically.")
	}

	const authSpinner = spinner()
	authSpinner.start("Waiting for authentication...")

	let tokenResult: Required<TokenResponse> | null = null
	try {
		tokenResult = await pollForToken(
			state.session.device_code,
			state.session.interval,
		)
	} catch (error) {
		authSpinner.stop("Authentication failed.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Authentication failed.")
		return
	}

	if (!tokenResult) {
		authSpinner.stop("Authentication timed out.")
		process.exitCode = 1
		log.error("Authentication timed out.")
		outro("Authentication failed.")
		return
	}

	authSpinner.stop("Authentication complete.")
	configureCredentialHelper(SKSUP_BASE_URL)
	storeCredentials(SKSUP_BASE_URL, tokenResult.user_id, tokenResult.token)

	log.success(`Authenticated as ${tokenResult.email}`)
	note(
		`Add your marketplace to Claude Code:\n  /plugin marketplace add ${SKSUP_BASE_URL}/me/marketplace`,
		"Next steps",
	)
	outro("Done.")
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
				throw new Error("Authentication completed but missing token data.")
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
	}

	return null
}
