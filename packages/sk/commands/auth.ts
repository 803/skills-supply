import { consola } from "consola"
import { CommandResult, printOutcome } from "@/commands/types"
import { configureCredentialHelper } from "@/credentials/helper"
import { storeCredentials } from "@/credentials/store"
import { SK_BASE_URL } from "@/env"
import type { NetworkError } from "@/types/errors"
import { openBrowser } from "@/utils/browser"
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

	const gitCheck = ensureGitAvailable()
	if (!gitCheck.ok) {
		printOutcome(CommandResult.failed(gitCheck.error))
		return
	}

	consola.start("Starting authentication...")

	let state: AuthState = { phase: "starting" }
	const sessionResult = await createDeviceSession()
	if (!sessionResult.ok) {
		printOutcome(CommandResult.failed(sessionResult.error))
		return
	}
	state = { phase: "waiting", session: sessionResult.value }
	consola.success("Device session created.")

	if (!state.session) {
		const message = "Authentication session missing."
		printOutcome(
			CommandResult.failed({
				field: "session",
				message,
				source: "manual",
				type: "validation",
			}),
		)
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
	const tokenResultResponse = await pollForToken(
		state.session.device_code,
		state.session.interval,
	)
	if (!tokenResultResponse.ok) {
		printOutcome(CommandResult.failed(tokenResultResponse.error))
		return
	}
	tokenResult = tokenResultResponse.value

	if (!tokenResult) {
		const message = "Authentication timed out."
		printOutcome(
			CommandResult.failed({
				field: "token",
				message,
				source: "manual",
				type: "validation",
			}),
		)
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

async function createDeviceSession(): Promise<
	{ ok: true; value: DeviceSessionResponse } | { ok: false; error: NetworkError }
> {
	let response: Response
	try {
		response = await fetchWithRetry(`${SK_BASE_URL}/auth/cli`, {
			method: "POST",
		})
	} catch (error) {
		return {
			error: {
				message: "Failed to start authentication session.",
				rawError: error instanceof Error ? error : undefined,
				source: `${SK_BASE_URL}/auth/cli`,
				type: "network",
			},
			ok: false,
		}
	}

	if (!response.ok) {
		return {
			error: {
				message: "Failed to start authentication session.",
				source: `${SK_BASE_URL}/auth/cli`,
				status: response.status,
				type: "network",
			},
			ok: false,
		}
	}

	return { ok: true, value: (await response.json()) as DeviceSessionResponse }
}

async function pollForToken(
	deviceCode: string,
	intervalSeconds: number,
): Promise<
	| { ok: true; value: Required<TokenResponse> | null }
	| {
			ok: false
			error: {
				type: "validation"
				field: string
				message: string
				source: "manual"
			}
	  }
> {
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
				const message = "Authentication completed but missing token data."
				return {
					error: {
						field: "token",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			return {
				ok: true,
				value: {
					email: data.email,
					status: data.status,
					token: data.token,
					user_id: data.user_id,
					username: data.username ?? data.user_id,
				},
			}
		}

		if (data.status === "expired") {
			return { ok: true, value: null }
		}
	}

	return { ok: true, value: null }
}
