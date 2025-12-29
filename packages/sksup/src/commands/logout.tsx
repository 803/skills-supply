import { useApp } from "ink"
import type { ReactElement } from "react"
import { useEffect, useMemo, useState } from "react"
import { removeCredentials } from "@/credentials/remove"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SKSUP_BASE_URL } from "@/env"
import { MessageList } from "@/ui/messages"
import { runInkApp } from "@/ui/render"
import { formatError } from "@/utils/errors"
import { fetchWithRetry } from "@/utils/fetch"

type LogoutPhase = "loading" | "unauthenticated" | "success" | "error"

interface LogoutState {
	phase: LogoutPhase
	error?: string
}

export async function logout(): Promise<void> {
	await runInkApp(<LogoutApp />)
}

function LogoutApp(): ReactElement {
	const { exit } = useApp()
	const [state, setState] = useState<LogoutState>({ phase: "loading" })

	useEffect(() => {
		let active = true

		const run = async () => {
			try {
				const creds = getStoredCredentials(SKSUP_BASE_URL)
				if (!creds) {
					setState({ phase: "unauthenticated" })
					return
				}

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

				if (!active) {
					return
				}

				setState({ phase: "success" })
			} catch (error) {
				if (!active) {
					return
				}

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
		if (state.phase !== "loading") {
			exit()
		}
	}, [exit, state.phase])

	const lines = useMemo(() => logoutLines(state), [state])

	return <MessageList lines={lines} />
}

function logoutLines(state: LogoutState): string[] {
	if (state.phase === "unauthenticated") {
		return ["Not authenticated."]
	}

	if (state.phase === "success") {
		return ["Logged out successfully."]
	}

	if (state.phase === "error") {
		return ["Failed to log out.", state.error ?? "Unknown error."]
	}

	return ["Logging out..."]
}
