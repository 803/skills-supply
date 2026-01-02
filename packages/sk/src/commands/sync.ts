import { isCancel, multiselect } from "@clack/prompts"
import { consola } from "consola"
import {
	buildParentPromptMessage,
	type ManifestSelection,
	resolveGlobalManifest,
	resolveLocalManifest,
	warnIfSubdirectory,
} from "@/src/commands/manifest-selection"
import { CommandResult, printOutcome } from "@/src/commands/types"
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
	try {
		const selectionResult = options.global
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

		if (selectionResult.status !== "completed") {
			printOutcome(selectionResult)
			return
		}

		const result = await syncWithSelection(selectionResult.value, {
			dryRun: options.dryRun,
			nonInteractive: options.nonInteractive,
		})
		printOutcome(result)
	} catch (error) {
		consola.error(formatError(error))
		consola.error("Sync failed.")
		process.exitCode = 1
	}
}

export async function syncWithSelection(
	selection: ManifestSelection,
	options: { dryRun: boolean; nonInteractive: boolean },
): Promise<CommandResult<void>> {
	consola.info("sk sync")

	try {
		if (selection.scope === "local") {
			warnIfSubdirectory(selection)
		}

		const agentResult = await resolveSyncAgents(selection, options.nonInteractive)
		if (agentResult.status !== "completed") {
			return agentResult
		}

		consola.start(options.dryRun ? "Planning sync..." : "Syncing skills...")

		const result = await runSync({
			agents: agentResult.value.agents,
			dryRun: options.dryRun,
			manifest: agentResult.value.manifest,
		})
		if (!result.ok) {
			consola.error(`[${result.error.stage}] ${result.error.message}`)
			consola.error("Sync failed.")
			process.exitCode = 1
			return CommandResult.failed()
		}

		if (result.value.noOpReason === "no-dependencies") {
			consola.success(options.dryRun ? "Plan complete." : "Sync complete.")
			return CommandResult.unchanged("No dependencies to sync.")
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

		return CommandResult.completed(undefined)
	} catch (error) {
		consola.error(formatError(error))
		consola.error("Sync failed.")
		process.exitCode = 1
		return CommandResult.failed()
	}
}

type SyncAgentsData = { agents: ResolvedAgent[]; manifest: Manifest }

const NO_AGENTS_CONFIGURED = "No agents configured. Use `sk agent add` to enable agents."
const NO_AGENTS_ENABLED =
	"All agents are disabled. Use `sk agent add` or enable agents in the [agents] section."

async function resolveSyncAgents(
	selection: ManifestSelection,
	nonInteractive: boolean,
): Promise<CommandResult<SyncAgentsData>> {
	let manifest = selection.manifest
	if (manifest.agents.size === 0) {
		if (nonInteractive) {
			return CommandResult.unchanged(NO_AGENTS_CONFIGURED)
		}

		const detected = await detectInstalledAgents()
		if (!detected.ok) {
			throw new Error(detected.error.message)
		}

		if (detected.value.length === 0) {
			return CommandResult.unchanged("No installed agents detected.")
		}

		const agentOptions: { label: string; value: AgentId }[] = detected.value.map(
			(agent) => ({
				label: `${agent.displayName} (${agent.id})`,
				value: agent.id,
			}),
		)

		const selected = await multiselect<AgentId>({
			initialValues: [],
			message: "Select enabled agents",
			options: agentOptions,
			required: true,
		})

		if (isCancel(selected)) {
			return CommandResult.cancelled()
		}

		const selectedSet = new Set(selected)
		if (selectedSet.size === 0) {
			throw new Error("Select at least one agent to sync.")
		}

		let updated = manifest
		for (const agentId of selectedSet) {
			updated = setAgent(updated, agentId, true)
		}

		await saveManifest(updated, selection.manifestPath, selection.serializeOptions)
		manifest = updated
	}

	const enabled = [...manifest.agents.entries()]
		.filter(([, enabled]) => enabled)
		.map(([agentId]) => agentId)

	if (enabled.length === 0) {
		return CommandResult.unchanged(NO_AGENTS_ENABLED)
	}

	const scope: AgentScope =
		selection.scope === "global"
			? { homeDir: selection.scopeRoot, type: "global" }
			: { projectRoot: selection.scopeRoot, type: "local" }
	const agents: ResolvedAgent[] = []
	for (const agentId of enabled) {
		const lookup = getAgentById(agentId)
		if (!lookup.ok) {
			throw new Error(lookup.error.message)
		}
		agents.push(resolveAgent(lookup.value, scope))
	}

	return CommandResult.completed({ agents, manifest })
}
