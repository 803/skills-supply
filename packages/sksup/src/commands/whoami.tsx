import { useApp } from "ink"
import type { ReactElement } from "react"
import { useEffect, useMemo, useState } from "react"
import { getStoredCredentials } from "@/credentials/retrieve"
import { SKSUP_BASE_URL } from "@/env"
import { MessageList } from "@/ui/messages"
import { runInkApp } from "@/ui/render"
import { fetchWithRetry } from "@/utils/fetch"

type WhoamiPhase = "loading" | "unauthenticated" | "resolved"

interface MeResponse {
	username: string
}

interface WhoamiState {
	phase: WhoamiPhase
	username?: string
}

export async function whoami(): Promise<void> {
	await runInkApp(<WhoamiApp />)
}

function WhoamiApp(): ReactElement {
	const { exit } = useApp()
	const [state, setState] = useState<WhoamiState>({ phase: "loading" })

	useEffect(() => {
		let active = true

		const run = async () => {
			const creds = getStoredCredentials(SKSUP_BASE_URL)
			if (!creds) {
				process.exitCode = 1
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

				if (response.ok) {
					const user = (await response.json()) as MeResponse
					setState({ phase: "resolved", username: user.username })
					return
				}
			} catch {
				// Fall back to stored username
			}

			if (!active) {
				return
			}

			setState({ phase: "resolved", username: creds.username })
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

	const lines = useMemo(() => whoamiLines(state), [state])

	return <MessageList lines={lines} />
}

function whoamiLines(state: WhoamiState): string[] {
	if (state.phase === "unauthenticated") {
		return ["Not authenticated."]
	}

	if (state.phase === "resolved" && state.username) {
		return [state.username]
	}

	return ["Checking identity..."]
}
