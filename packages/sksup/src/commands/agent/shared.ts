import { intro, log, note, outro, spinner } from "@clack/prompts"
import { loadManifestFromCwd, saveManifest } from "@/commands/manifest"
import { getAgentById } from "@/core/agents/registry"
import type { AgentDefinition } from "@/core/agents/types"
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
	intro(`sksup agent ${action === "enable" ? "add" : "remove"}`)

	const actionSpinner = spinner()
	actionSpinner.start("Updating agents...")

	try {
		const result = await updateAgentManifest(agentId, action)
		actionSpinner.stop("Agent settings updated.")

		if (result.created) {
			log.info(`Created ${result.manifestPath}.`)
		}

		const agentLabel = `${result.agent.displayName} (${result.agent.id})`

		if (!result.changed) {
			log.info(`Agent already ${result.action}d: ${agentLabel}.`)
			note(`Manifest: ${result.manifestPath}`, "No changes")
			outro("Done.")
			return
		}

		const actionLabel = result.action === "enable" ? "Enabled" : "Disabled"
		log.success(`${actionLabel} agent: ${agentLabel}.`)
		note(`Manifest: ${result.manifestPath}`, "Updated")
		outro("Done.")
	} catch (error) {
		actionSpinner.stop("Failed to update agents.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Agent update failed.")
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

	const currentValue = manifest.agents[lookup.value.id]
	const changed = currentValue !== desired
	if (changed) {
		manifest.agents[lookup.value.id] = desired
		await saveManifest(manifest, manifestPath)
	}

	return {
		action,
		agent: lookup.value,
		changed,
		created,
		manifestPath,
	}
}
