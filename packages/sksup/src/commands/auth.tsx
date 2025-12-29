import { useApp } from "ink"
import type { ReactElement } from "react"
import { useEffect, useMemo, useState } from "react"
import { configureCredentialHelper } from "@/credentials/helper"
import { storeCredentials } from "@/credentials/store"
import { SKSUP_BASE_URL } from "@/env"
import { MessageList } from "@/ui/messages"
import { runInkApp } from "@/ui/render"
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
	opened?: boolean
	email?: string
	error?: string
}

export async function auth(): Promise<void> {
	await runInkApp(<AuthApp />)
}

function AuthApp(): ReactElement {
	const { exit } = useApp()
	const [state, setState] = useState<AuthState>({ phase: "starting" })

	useEffect(() => {
		let active = true

		const run = async () => {
			try {
				ensureGitAvailable()

				const session = await createDeviceSession()
				if (!active) {
					return
				}

				setState({ phase: "waiting", session })

				const opened = await openBrowser(session.verification_url)
				if (!active) {
					return
				}

				setState({ opened, phase: "waiting", session })

				const result = await pollForToken(session.device_code, session.interval)
				if (!active) {
					return
				}

				if (!result) {
					process.exitCode = 1
					setState({ phase: "timeout" })
					return
				}

				configureCredentialHelper(SKSUP_BASE_URL)
				storeCredentials(SKSUP_BASE_URL, result.user_id, result.token)

				setState({ email: result.email, phase: "success" })
			} catch (error) {
				process.exitCode = 1
				setState({ error: formatError(error), phase: "error" })
			}
		}

		void run()

		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		if (
			state.phase === "success" ||
			state.phase === "timeout" ||
			state.phase === "error"
		) {
			exit()
		}
	}, [exit, state.phase])

	const lines = useMemo(() => authLines(state), [state])

	return <MessageList lines={lines} />
}

function authLines(state: AuthState): string[] {
	if (state.phase === "waiting" && state.session) {
		const lines = [
			"",
			"Enter this code in your browser:",
			`  ${state.session.user_code}`,
			"",
			`Open: ${state.session.verification_url}`,
			"",
		]

		if (state.opened === false) {
			lines.push(
				"Couldn't open browser automatically.",
				"Please visit the URL above to authenticate.",
				"",
			)
		}

		lines.push("Waiting for authentication...")
		return lines
	}

	if (state.phase === "success" && state.email) {
		return [
			"",
			`✓ Authenticated as ${state.email}`,
			"",
			"Add your marketplace to Claude Code:",
			`  /plugin marketplace add ${SKSUP_BASE_URL}/me/marketplace`,
			"",
		]
	}

	if (state.phase === "timeout") {
		return ["Authentication timed out. Please try again."]
	}

	if (state.phase === "error") {
		return ["Authentication failed.", state.error ?? "Unknown error."]
	}

	return ["Starting authentication..."]
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
