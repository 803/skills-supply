import { consola } from "consola"
import { getAgentById } from "@/core/agents/registry"
import type { AgentDefinition } from "@/core/agents/types"
import { loadManifestFromCwd, saveManifest } from "@/core/manifest/fs"
import { getAgent, setAgent } from "@/core/manifest/transform"
import type { AgentId } from "@/core/types/branded"
import { formatError } from "@/utils/errors"

type AgentAction = "enable" | "disable"

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
	consola.info(`sk agent ${action === "enable" ? "add" : "remove"}`)
	consola.start("Updating agents...")

	try {
		const result = await updateAgentManifest(agentId, action)
		consola.success("Agent settings updated.")

		if (result.created) {
			consola.info(`Created ${result.manifestPath}.`)
		}

		const agentLabel = `${result.agent.displayName} (${result.agent.id})`

		if (!result.changed) {
			consola.info(`Agent already ${result.action}d: ${agentLabel}.`)
			consola.info(`Manifest: ${result.manifestPath} (no changes).`)
			consola.success("Done.")
			return
		}

		const actionLabel = result.action === "enable" ? "Enabled" : "Disabled"
		consola.success(`${actionLabel} agent: ${agentLabel}.`)
		consola.info(`Manifest: ${result.manifestPath} (updated).`)
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Agent update failed.")
	}
}

async function updateAgentManifest(
	agentId: string,
	action: AgentAction,
): Promise<AgentUpdateResult> {
	const lookup = getAgentById(agentId)
	if (!lookup.ok) {
		throw new Error(lookup.error.message)
	}

	const desired = action === "enable"
	const manifestResult = await loadManifestFromCwd({ createIfMissing: desired })
	const { manifest, created, manifestPath } = manifestResult

	const validatedAgentId = lookup.value.id as AgentId
	const currentValue = getAgent(manifest, validatedAgentId)
	const changed = currentValue !== desired
	if (changed) {
		const updated = setAgent(manifest, validatedAgentId, desired)
		await saveManifest(updated, manifestPath)
	}

	return {
		action,
		agent: lookup.value,
		changed,
		created,
		manifestPath,
	}
}
