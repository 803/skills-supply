import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { useApp } from "ink"
import type { ReactElement } from "react"
import { useEffect, useMemo, useState } from "react"
import { getAgentById } from "@/core/agents/registry"
import type { AgentDefinition } from "@/core/agents/types"
import { parseManifest } from "@/core/manifest/parse"
import type { Manifest } from "@/core/manifest/types"
import { serializeManifest } from "@/core/manifest/write"
import { MessageList } from "@/ui/messages"
import { runInkApp } from "@/ui/render"
import { formatError } from "@/utils/errors"

type AgentAction = "enable" | "disable"

type AgentCommandPhase = "working" | "success" | "noop" | "error"

interface AgentCommandState {
	phase: AgentCommandPhase
	result?: AgentUpdateResult
	error?: string
}

interface AgentUpdateResult {
	action: AgentAction
	agent: AgentDefinition
	changed: boolean
	created: boolean
	manifestPath: string
}

export async function runAgentUpdate(
	agentId: string,
	action: AgentAction,
): Promise<void> {
	await runInkApp(
		<AgentUpdateApp
			action={action}
			agentId={agentId}
		/>,
	)
}

function AgentUpdateApp({
	agentId,
	action,
}: {
	agentId: string
	action: AgentAction
}): ReactElement {
	const { exit } = useApp()
	const [state, setState] = useState<AgentCommandState>({ phase: "working" })

	useEffect(() => {
		let active = true

		const run = async () => {
			try {
				const result = await updateAgentManifest(agentId, action)
				if (!active) {
					return
				}

				setState({
					phase: result.changed ? "success" : "noop",
					result,
				})
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
	}, [action, agentId])

	useEffect(() => {
		if (state.phase !== "working") {
			exit()
		}
	}, [exit, state.phase])

	const lines = useMemo(() => buildLines(state), [state])

	return <MessageList lines={lines} />
}

async function updateAgentManifest(
	agentId: string,
	action: AgentAction,
): Promise<AgentUpdateResult> {
	const lookup = getAgentById(agentId)
	if (!lookup.ok) {
		throw new Error(lookup.error.message)
	}

	const manifestPath = path.join(process.cwd(), "skills.toml")
	const desired = action === "enable"
	let manifest: Manifest
	let created = false

	try {
		const contents = await readFile(manifestPath, "utf8")
		const parsed = parseManifest(contents, manifestPath)
		if (!parsed.ok) {
			throw new Error(parsed.error.message)
		}

		manifest = parsed.value
	} catch (error) {
		if (isNotFound(error)) {
			if (!desired) {
				throw new Error("skills.toml not found in the current directory.")
			}

			manifest = {
				agents: {},
				packages: {},
				sourcePath: manifestPath,
			}
			created = true
		} else {
			throw error
		}
	}

	const currentValue = manifest.agents[lookup.value.id]
	const changed = currentValue !== desired
	if (changed) {
		manifest.agents[lookup.value.id] = desired
		const serialized = serializeManifest(manifest)
		await writeFile(manifestPath, serialized, "utf8")
	}

	return {
		action,
		agent: lookup.value,
		changed,
		created,
		manifestPath,
	}
}

function buildLines(state: AgentCommandState): string[] {
	if (state.phase === "working") {
		return ["Updating agents..."]
	}

	if (state.phase === "error") {
		return ["Failed to update agents.", state.error ?? "Unknown error."]
	}

	if (!state.result) {
		return ["No agent update result available."]
	}

	const actionLabel = state.result.action === "enable" ? "Enabled" : "Disabled"
	const agentLabel = `${state.result.agent.displayName} (${state.result.agent.id})`

	const lines: string[] = []
	if (state.result.created) {
		lines.push(`Created ${state.result.manifestPath}.`)
	}

	if (state.phase === "noop") {
		lines.push(`Agent already ${state.result.action}d: ${agentLabel}.`)
		lines.push(`Manifest: ${state.result.manifestPath}`)
		return lines
	}

	lines.push(`${actionLabel} agent: ${agentLabel}.`)
	lines.push(`Manifest: ${state.result.manifestPath}`)
	return lines
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}
