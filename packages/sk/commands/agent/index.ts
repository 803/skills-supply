import { isCancel, multiselect } from "@clack/prompts"
import { consola } from "consola"
import { getAgentDetectionMap, listAgents } from "@/agents/registry"
import {
	buildParentPromptMessage,
	resolveLocalManifest,
} from "@/commands/manifest-selection"
import { CommandResult, printOutcome } from "@/commands/types"
import { saveManifest } from "@/manifest/fs"
import { getAgent, getEnabledAgents, setAgent } from "@/manifest/transform"

export async function agentInteractive(): Promise<void> {
	consola.info("sk agent")

	const selectionResult = await resolveLocalManifest({
		createIfMissing: false,
		nonInteractive: false,
		parentPrompt: {
			buildMessage: (projectRoot, cwd) =>
				buildParentPromptMessage(projectRoot, cwd, {
					action: "modify",
					warnAboutSkillVisibility: false,
				}),
		},
		promptToCreate: true,
	})
	if (selectionResult.status !== "completed") {
		printOutcome(selectionResult)
		return
	}
	const selection = selectionResult.value

	const agents = listAgents()
	const enabled = new Set(getEnabledAgents(selection.manifest))

	// If no agents are enabled in manifest, use CLI detection for pre-selection
	let initialValues: string[]
	if (enabled.size > 0) {
		initialValues = agents
			.filter((agent) => enabled.has(agent.id))
			.map((agent) => agent.id)
	} else {
		const detectionResult = await getAgentDetectionMap()
		if (!detectionResult.ok) {
			printOutcome(CommandResult.failed(detectionResult.error))
			return
		}
		initialValues = agents
			.filter((agent) => detectionResult.value[agent.id])
			.map((agent) => agent.id)
	}

	const selected = await multiselect({
		initialValues,
		message: "Select agents to sync (detected agents are pre-selected)",
		options: agents.map((agent) => ({
			label: `${agent.displayName} (${agent.id})`,
			value: agent.id,
		})),
	})

	if (isCancel(selected)) {
		printOutcome(CommandResult.cancelled())
		return
	}

	const selectedSet = new Set(selected)
	let updatedManifest = selection.manifest
	let changed = false
	for (const agent of agents) {
		const desired = selectedSet.has(agent.id)
		if (getAgent(updatedManifest, agent.id) !== desired) {
			updatedManifest = setAgent(updatedManifest, agent.id, desired)
			changed = true
		}
	}

	if (!changed) {
		printOutcome(
			CommandResult.unchanged(
				`No agent changes needed. Manifest: ${selection.manifestPath} (no changes).`,
			),
		)
		return
	}

	const saved = await saveManifest(
		updatedManifest,
		selection.manifestPath,
		selection.serializeOptions,
	)
	if (!saved.ok) {
		printOutcome(CommandResult.failed(saved.error))
		return
	}
	consola.success("Updated agent selections.")
	consola.info(`Manifest: ${selection.manifestPath} (updated).`)
	printOutcome(CommandResult.completed(undefined))
}
