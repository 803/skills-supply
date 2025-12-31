import { isCancel, multiselect } from "@clack/prompts"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	type ManifestSelection,
	resolveGlobalManifest,
	resolveLocalManifest,
	warnIfSubdirectory,
} from "@/src/commands/manifest-selection"
import {
	type AgentScope,
	detectInstalledAgents,
	getAgentById,
	resolveAgent,
} from "@/src/core/agents/registry"
import type { ResolvedAgent } from "@/src/core/agents/types"
import { saveManifest } from "@/src/core/manifest/fs"
import { setAgent } from "@/src/core/manifest/transform"
import type { Manifest } from "@/src/core/manifest/types"
import { runSync } from "@/src/core/sync/sync"
import type { AgentId } from "@/src/core/types/branded"
import { formatError } from "@/src/utils/errors"

export async function syncCommand(options: {
	dryRun: boolean
	global: boolean
	nonInteractive: boolean
}): Promise<void> {
	consola.info("sk sync")

	try {
		const selection = options.global
			? await resolveGlobalManifest({
					createIfMissing: false,
					nonInteractive: options.nonInteractive,
					promptToCreate: true,
				})
			: await resolveLocalManifest({
					createIfMissing: false,
					nonInteractive: options.nonInteractive,
					parentPrompt: {
						buildMessage: (projectRoot, cwd) =>
							buildParentPromptMessage(projectRoot, cwd, {
								action: "sync",
								warnAboutSkillVisibility: true,
							}),
					},
					promptToCreate: true,
				})

		if (!options.global) {
			warnIfSubdirectory(selection)
		}

		const agentResult = await resolveSyncAgents(selection, options.nonInteractive)
		if (!agentResult.ok) {
			if (agentResult.noAgentsConfigured) {
				consola.info(
					"No agents configured. Run interactively or add [agents] section.",
				)
				return
			}
			throw new Error(agentResult.message)
		}

		consola.start(options.dryRun ? "Planning sync..." : "Syncing skills...")

		const result = await runSync({
			agents: agentResult.agents,
			dryRun: options.dryRun,
			manifest: agentResult.manifest,
		})
		if (!result.ok) {
			consola.error(`[${result.error.stage}] ${result.error.message}`)
			consola.error("Sync failed.")
			process.exitCode = 1
			return
		}

		if (result.value.noOpReason === "no-dependencies") {
			consola.success(options.dryRun ? "Plan complete." : "Sync complete.")
			consola.info("No dependencies to sync.")
			return
		}

		consola.success(options.dryRun ? "Plan complete." : "Sync complete.")
		consola.info(`Found ${result.value.manifests} manifest(s).`)
		consola.info(
			`Resolved ${result.value.dependencies} dependenc${
				result.value.dependencies === 1 ? "y" : "ies"
			}.`,
		)
		consola.info(`Enabled agents: ${result.value.agents.join(", ")}`)

		const installVerb = options.dryRun ? "Would install" : "Installed"
		const removeVerb = options.dryRun ? "remove" : "removed"
		consola.info(
			`${installVerb} ${result.value.installed} skill(s), ${removeVerb} ${result.value.removed} stale skill(s).`,
		)

		for (const warning of result.value.warnings) {
			consola.warn(warning)
		}

		consola.success("Done.")
	} catch (error) {
		consola.error(formatError(error))
		consola.error("Sync failed.")
		process.exitCode = 1
	}
}

type SyncAgentsResult =
	| {
			ok: true
			agents: ResolvedAgent[]
			manifest: Manifest
	  }
	| {
			ok: false
			message: string
			noAgentsConfigured: boolean
	  }

async function resolveSyncAgents(
	selection: ManifestSelection,
	nonInteractive: boolean,
): Promise<SyncAgentsResult> {
	let manifest = selection.manifest
	if (manifest.agents.size === 0) {
		if (nonInteractive) {
			return {
				message: "No agents configured.",
				noAgentsConfigured: true,
				ok: false,
			}
		}

		const detected = await detectInstalledAgents()
		if (!detected.ok) {
			return {
				message: detected.error.message,
				noAgentsConfigured: false,
				ok: false,
			}
		}

		if (detected.value.length === 0) {
			return {
				message: "No installed agents detected.",
				noAgentsConfigured: false,
				ok: false,
			}
		}

		const selected = await multiselect({
			message: "Select enabled agents",
			options: detected.value.map((agent) => ({
				label: `${agent.displayName} (${agent.id})`,
				value: agent.id,
			})),
		})

		if (isCancel(selected)) {
			return { message: "Canceled.", noAgentsConfigured: false, ok: false }
		}

		const selectedSet = new Set(selected)
		let updated = manifest
		for (const agent of detected.value) {
			const desired = selectedSet.has(agent.id)
			const agentId = agent.id as AgentId
			updated = setAgent(updated, agentId, desired)
		}

		await saveManifest(updated, selection.manifestPath, selection.serializeOptions)
		manifest = updated
	}

	const enabled = [...manifest.agents.entries()]
		.filter(([, enabled]) => enabled)
		.map(([agentId]) => agentId)

	if (enabled.length === 0) {
		return {
			message: "No agents are enabled in the manifest.",
			noAgentsConfigured: false,
			ok: false,
		}
	}

	const scope: AgentScope =
		selection.scope === "global"
			? { homeDir: selection.scopeRoot, type: "global" }
			: { projectRoot: selection.scopeRoot, type: "local" }
	const agents: ResolvedAgent[] = []
	for (const agentId of enabled) {
		const lookup = getAgentById(agentId)
		if (!lookup.ok) {
			return {
				message: lookup.error.message,
				noAgentsConfigured: false,
				ok: false,
			}
		}
		agents.push(resolveAgent(lookup.value, scope))
	}

	return { agents, manifest, ok: true }
}
