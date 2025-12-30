import { consola } from "consola"
import { configureCredentialHelper } from "@/credentials/helper"
import { storeCredentials } from "@/credentials/store"
import { SK_BASE_URL } from "@/env"
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
	consola.info("sk auth")

	try {
		ensureGitAvailable()
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Authentication failed.")
		return
	}

	consola.start("Starting authentication...")

	let state: AuthState = { phase: "starting" }
	try {
		const session = await createDeviceSession()
		state = { phase: "waiting", session }
		consola.success("Device session created.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Authentication failed.")
		return
	}

	if (!state.session) {
		process.exitCode = 1
		consola.error("Authentication session missing.")
		consola.error("Authentication failed.")
		return
	}

	consola.info(
		`Authenticate\nCode: ${state.session.user_code}\nOpen: ${state.session.verification_url}`,
	)

	let opened = false
	try {
		opened = await openBrowser(state.session.verification_url)
	} catch {
		opened = false
	}

	if (!opened) {
		consola.warn("Couldn't open browser automatically.")
	}

	consola.start("Waiting for authentication...")

	let tokenResult: Required<TokenResponse> | null = null
	try {
		tokenResult = await pollForToken(
			state.session.device_code,
			state.session.interval,
		)
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Authentication failed.")
		return
	}

	if (!tokenResult) {
		process.exitCode = 1
		consola.error("Authentication timed out.")
		consola.error("Authentication failed.")
		return
	}

	consola.success("Authentication complete.")
	configureCredentialHelper(SK_BASE_URL)
	storeCredentials(SK_BASE_URL, tokenResult.user_id, tokenResult.token)

	consola.success(`Authenticated as ${tokenResult.email}`)
	consola.info(
		`Next steps\nAdd your marketplace to Claude Code:\n  /plugin marketplace add ${SK_BASE_URL}/me/marketplace`,
	)
	consola.success("Done.")
}

async function createDeviceSession(): Promise<DeviceSessionResponse> {
	const response = await fetchWithRetry(`${SK_BASE_URL}/auth/cli`, {
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
			response = await fetchWithRetry(`${SK_BASE_URL}/auth/cli/token`, {
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
