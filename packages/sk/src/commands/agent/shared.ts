import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveGlobalManifest,
	resolveLocalManifest,
} from "@/src/commands/manifest-selection"
import { getAgentById } from "@/src/core/agents/registry"
import type { AgentDefinition } from "@/src/core/agents/types"
import { saveManifest } from "@/src/core/manifest/fs"
import { getAgent, setAgent } from "@/src/core/manifest/transform"
import { formatError } from "@/src/utils/errors"

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
	options: { global: boolean; nonInteractive: boolean },
): Promise<void> {
	consola.info(`sk agent ${action === "enable" ? "add" : "remove"}`)

	try {
		const result = await updateAgentManifest(agentId, action, options)
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
	options: { global: boolean; nonInteractive: boolean },
): Promise<AgentUpdateResult> {
	const lookup = getAgentById(agentId)
	if (!lookup.ok) {
		throw new Error(lookup.error.message)
	}

	const desired = action === "enable"
	const selection = options.global
		? await resolveGlobalManifest({
				createIfMissing: false,
				nonInteractive: options.nonInteractive,
				promptToCreate: desired,
			})
		: await resolveLocalManifest({
				createIfMissing: false,
				nonInteractive: options.nonInteractive,
				parentPrompt: {
					buildMessage: (projectRoot, cwd) =>
						buildParentPromptMessage(projectRoot, cwd, {
							action: "modify",
							warnAboutSkillVisibility: false,
						}),
				},
				promptToCreate: desired,
			})
	const { manifest, manifestPath } = selection

	const currentValue = getAgent(manifest, lookup.value.id)
	const changed = currentValue !== desired
	if (changed) {
		const updated = setAgent(manifest, lookup.value.id, desired)
		await saveManifest(updated, manifestPath, selection.serializeOptions)
	}

	return {
		action,
		agent: lookup.value,
		changed,
		created: selection.created,
		manifestPath,
	}
}
