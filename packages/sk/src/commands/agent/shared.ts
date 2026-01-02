import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveGlobalManifest,
	resolveLocalManifest,
} from "@/src/commands/manifest-selection"
import { CommandResult, printOutcome } from "@/src/commands/types"
import { getAgentById } from "@/src/core/agents/registry"
import type { AgentDefinition } from "@/src/core/agents/types"
import { saveManifest } from "@/src/core/manifest/fs"
import { getAgent, setAgent } from "@/src/core/manifest/transform"
import { formatError } from "@/src/utils/errors"

type AgentAction = "enable" | "disable"

type AgentUpdateData = {
	action: AgentAction
	agent: AgentDefinition
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
		if (result.status === "completed") {
			consola.success("Agent settings updated.")

			if (result.value.created) {
				consola.info(`Created ${result.value.manifestPath}.`)
			}

			const agentLabel = `${result.value.agent.displayName} (${result.value.agent.id})`

			const actionLabel = result.value.action === "enable" ? "Enabled" : "Disabled"
			consola.success(`${actionLabel} agent: ${agentLabel}.`)
			consola.info(`Manifest: ${result.value.manifestPath} (updated).`)
		}

		printOutcome(result)
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
): Promise<CommandResult<AgentUpdateData>> {
	const lookup = getAgentById(agentId)
	if (!lookup.ok) {
		throw new Error(lookup.error.message)
	}

	const desired = action === "enable"
	const selectionResult = options.global
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
	if (selectionResult.status !== "completed") {
		return selectionResult
	}
	const { manifest, manifestPath, serializeOptions, created } = selectionResult.value

	const currentValue = getAgent(manifest, lookup.value.id)
	const changed = currentValue !== desired
	if (changed) {
		const updated = setAgent(manifest, lookup.value.id, desired)
		await saveManifest(updated, manifestPath, serializeOptions)
	}

	if (!changed) {
		const agentLabel = `${lookup.value.displayName} (${lookup.value.id})`
		return CommandResult.unchanged(
			`Agent already ${action}d: ${agentLabel}. Manifest: ${manifestPath} (no changes).`,
		)
	}

	return CommandResult.completed({
		action,
		agent: lookup.value,
		created,
		manifestPath,
	})
}
