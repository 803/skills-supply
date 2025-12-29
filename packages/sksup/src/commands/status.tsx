import { useApp } from "ink"
import type { ReactElement } from "react"
import { useEffect, useMemo, useState } from "react"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SKSUP_BASE_URL } from "@/env"
import { MessageList } from "@/ui/messages"
import { runInkApp } from "@/ui/render"
import { formatError } from "@/utils/errors"
import { fetchWithRetry } from "@/utils/fetch"

type StatusPhase = "loading" | "unauthenticated" | "invalid" | "success" | "error"

interface MeResponse {
	email: string
	username: string
}

interface StatusState {
	phase: StatusPhase
	error?: string
	user?: MeResponse
}

export async function status(): Promise<void> {
	await runInkApp(<StatusApp />)
}

function StatusApp(): ReactElement {
	const { exit } = useApp()
	const [state, setState] = useState<StatusState>({ phase: "loading" })

	useEffect(() => {
		let active = true

		const run = async () => {
			const creds = getStoredCredentials(SKSUP_BASE_URL)
			if (!creds) {
				setState({ phase: "unauthenticated" })
				return
			}

			try {
				const response = await fetchWithRetry(`${SKSUP_BASE_URL}/api/me`, {
					headers: {
						Authorization: `Bearer ${creds.token}`,
					},
				})

				if (!active) {
					return
				}

				if (!response.ok) {
					setState({ phase: "invalid" })
					return
				}

				const user = (await response.json()) as MeResponse
				if (!active) {
					return
				}

				setState({ phase: "success", user })
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

	const lines = useMemo(() => statusLines(state), [state])

	return <MessageList lines={lines} />
}

function statusLines(state: StatusState): string[] {
	if (state.phase === "unauthenticated") {
		return ["Not authenticated.", "Run `sksup auth` to authenticate."]
	}

	if (state.phase === "invalid") {
		return ["Token is invalid or expired.", "Run `sksup auth` to re-authenticate."]
	}

	if (state.phase === "success" && state.user) {
		return [
			`Logged in as: ${state.user.email}`,
			`Username: ${state.user.username}`,
			`Marketplace: ${SKSUP_BASE_URL}/me/marketplace`,
		]
	}

	if (state.phase === "error") {
		return ["Failed to fetch account info.", state.error ?? "Unknown error."]
	}

	return ["Checking authentication status..."]
}
