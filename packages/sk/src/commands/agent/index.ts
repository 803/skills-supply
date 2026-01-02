import { isCancel, multiselect } from "@clack/prompts"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveLocalManifest,
} from "@/src/commands/manifest-selection"
import { CommandResult, printOutcome } from "@/src/commands/types"
import { detectInstalledAgents } from "@/src/core/agents/registry"
import { saveManifest } from "@/src/core/manifest/fs"
import { getAgent, setAgent } from "@/src/core/manifest/transform"
import { formatError } from "@/src/utils/errors"

export async function agentInteractive(): Promise<void> {
	consola.info("sk agent")

	try {
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
		consola.start("Detecting installed agents...")

		const detected = await detectInstalledAgents()
		if (!detected.ok) {
			throw new Error(detected.error.message)
		}

		const installed = detected.value
		consola.success("Agent detection complete.")

		if (installed.length === 0) {
			printOutcome(CommandResult.unchanged("No installed agents detected."))
			return
		}
		const enabled = new Set(
			[...selection.manifest.agents.entries()]
				.filter(([, isEnabled]) => isEnabled)
				.map(([agentId]) => agentId),
		)

		const selected = await multiselect({
			initialValues: installed
				.map((agent) => agent.id)
				.filter((agentId) => enabled.has(agentId)),
			message: "Select enabled agents",
			options: installed.map((agent) => ({
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
		for (const agent of installed) {
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

		await saveManifest(
			updatedManifest,
			selection.manifestPath,
			selection.serializeOptions,
		)
		consola.success("Updated agent selections.")
		consola.info(`Manifest: ${selection.manifestPath} (updated).`)
		printOutcome(CommandResult.completed(undefined))
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Agent update failed.")
	}
}
