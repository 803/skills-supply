import { isCancel, multiselect } from "@clack/prompts"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	resolveLocalManifest,
} from "@/src/commands/manifest-selection"
import { detectInstalledAgents } from "@/src/core/agents/registry"
import { saveManifest } from "@/src/core/manifest/fs"
import { getAgent, setAgent } from "@/src/core/manifest/transform"
import { formatError } from "@/src/utils/errors"

export async function agentInteractive(): Promise<void> {
	consola.info("sk agent")

	try {
		const selection = await resolveLocalManifest({
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
		consola.start("Detecting installed agents...")

		const detected = await detectInstalledAgents()
		if (!detected.ok) {
			throw new Error(detected.error.message)
		}

		const installed = detected.value
		consola.success("Agent detection complete.")

		if (installed.length === 0) {
			consola.info("No installed agents detected.")
			consola.info("Nothing to update.")
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
			consola.info("Canceled.")
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
			consola.info("No agent changes needed.")
			consola.info(`Manifest: ${selection.manifestPath} (no changes).`)
			consola.success("Done.")
			return
		}

		await saveManifest(
			updatedManifest,
			selection.manifestPath,
			selection.serializeOptions,
		)
		consola.success("Updated agent selections.")
		consola.info(`Manifest: ${selection.manifestPath} (updated).`)
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Agent update failed.")
	}
}
