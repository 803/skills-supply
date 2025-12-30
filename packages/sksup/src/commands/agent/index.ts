import {
	confirm,
	intro,
	isCancel,
	log,
	multiselect,
	note,
	outro,
	spinner,
} from "@clack/prompts"
import {
	isManifestNotFoundError,
	loadManifestFromCwd,
	saveManifest,
} from "@/commands/manifest"
import { listAgents } from "@/core/agents/registry"
import { formatError } from "@/utils/errors"

export async function agentInteractive(): Promise<void> {
	intro("sksup agent")

	try {
		const manifestResult = await loadManifestForUpdate()
		const agents = listAgents()
		const detection = spinner()
		detection.start("Detecting installed agents...")

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

		detection.stop("Agent detection complete.")

		if (installed.length === 0) {
			log.info("No installed agents detected.")
			outro("Nothing to update.")
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
			outro("Canceled.")
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
			log.info("No agent changes needed.")
			note(`Manifest: ${manifestResult.manifestPath}`, "No changes")
			outro("Done.")
			return
		}

		await saveManifest(manifestResult.manifest, manifestResult.manifestPath)
		log.success("Updated agent selections.")
		note(`Manifest: ${manifestResult.manifestPath}`, "Updated")
		outro("Done.")
	} catch (error) {
		process.exitCode = 1
		log.error(formatError(error))
		outro("Agent update failed.")
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
			message: "skills.toml not found. Create it?",
		})
		if (isCancel(shouldCreate) || !shouldCreate) {
			throw new Error("Canceled.")
		}

		return await loadManifestFromCwd({ createIfMissing: true })
	}
}
