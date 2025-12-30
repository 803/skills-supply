import { confirm, isCancel, multiselect } from "@clack/prompts"
import { consola } from "consola"
import {
	isManifestNotFoundError,
	loadManifestFromCwd,
	saveManifest,
} from "@/commands/manifest"
import { listAgents } from "@/core/agents/registry"
import { formatError } from "@/utils/errors"

export async function agentInteractive(): Promise<void> {
	consola.info("sk agent")

	try {
		const manifestResult = await loadManifestForUpdate()
		const agents = listAgents()
		consola.start("Detecting installed agents...")

		const installed = []
		for (const agent of agents) {
			const detected = await agent.detect()
			if (!detected.ok) {
				throw new Error(detected.error.message)
			}

			if (detected.value) {
				installed.push(agent)
			}
		}

		consola.success("Agent detection complete.")

		if (installed.length === 0) {
			consola.info("No installed agents detected.")
			consola.info("Nothing to update.")
			return
		}
		const enabled = new Set(
			Object.entries(manifestResult.manifest.agents)
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
		let changed = false
		for (const agent of installed) {
			const desired = selectedSet.has(agent.id)
			if (manifestResult.manifest.agents[agent.id] !== desired) {
				manifestResult.manifest.agents[agent.id] = desired
				changed = true
			}
		}

		if (!changed) {
			consola.info("No agent changes needed.")
			consola.info(`Manifest: ${manifestResult.manifestPath} (no changes).`)
			consola.success("Done.")
			return
		}

		await saveManifest(manifestResult.manifest, manifestResult.manifestPath)
		consola.success("Updated agent selections.")
		consola.info(`Manifest: ${manifestResult.manifestPath} (updated).`)
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Agent update failed.")
	}
}

async function loadManifestForUpdate() {
	try {
		return await loadManifestFromCwd({ createIfMissing: false })
	} catch (error) {
		if (!isManifestNotFoundError(error)) {
			throw error
		}

		const shouldCreate = await confirm({
			message: "package.toml not found. Create it?",
		})
		if (isCancel(shouldCreate) || !shouldCreate) {
			throw new Error("Canceled.")
		}

		return await loadManifestFromCwd({ createIfMissing: true })
	}
}
