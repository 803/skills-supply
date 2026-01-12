import { homedir } from "node:os"
import path from "node:path"
import { isCancel, multiselect } from "@clack/prompts"
import type { AbsolutePath, AgentId } from "@skills-supply/core"
import {
	coerceAbsolutePathDirect,
	MANIFEST_FILENAME,
	SK_GLOBAL_DIR,
} from "@skills-supply/core"
import { consola } from "consola"
import { getAgentById, getAgentDetectionMap, listAgents } from "@/agents/registry"
import { CommandResult, printOutcome } from "@/commands/types"
import { ensureDir, safeStat } from "@/io/fs"
import { createEmptyManifest, saveManifest } from "@/manifest/fs"
import { setAgent } from "@/manifest/transform"
import type { Manifest } from "@/manifest/types"
import type { SkError } from "@/types/errors"

export async function initCommand(options: {
	agents?: string
	global: boolean
	nonInteractive: boolean
}): Promise<void> {
	consola.info("sk init")

	const manifestPathResult = resolveManifestPath(options.global)
	if (!manifestPathResult.ok) {
		printOutcome(CommandResult.failed(manifestPathResult.error))
		return
	}
	const manifestPath = manifestPathResult.value

	const missingResult = await assertManifestMissing(manifestPath)
	if (!missingResult.ok) {
		printOutcome(CommandResult.failed(missingResult.error))
		return
	}

	let manifest = createEmptyManifest(manifestPath, options.global ? "sk-global" : "cwd")

	const agentSelection = await resolveAgentSelection(
		options.agents,
		options.nonInteractive,
	)
	if (agentSelection.status !== "completed") {
		printOutcome(agentSelection)
		return
	}

	manifest = applyAgentSelection(manifest, agentSelection.value)
	const ensured = await ensureDir(path.dirname(manifestPath))
	if (!ensured.ok) {
		printOutcome(CommandResult.failed(ensured.error))
		return
	}
	const includeEmptyAgents = options.agents !== undefined || !options.nonInteractive
	const saved = await saveManifest(manifest, manifestPath, {
		includeEmptyAgents,
		includeEmptyDependencies: true,
	})
	if (!saved.ok) {
		printOutcome(CommandResult.failed(saved.error))
		return
	}

	consola.success("Manifest created.")
	consola.info(`Manifest: ${manifestPath}`)
	if (agentSelection.value.warning) {
		consola.warn(agentSelection.value.warning)
	}
	printOutcome(CommandResult.completed(undefined))
}

function resolveManifestPath(useGlobal: boolean):
	| {
			ok: true
			value: AbsolutePath
	  }
	| {
			ok: false
			error: {
				type: "validation"
				field: string
				message: string
				source: "manual"
			}
	  } {
	const resolved = useGlobal
		? path.join(homedir(), SK_GLOBAL_DIR, MANIFEST_FILENAME)
		: path.join(process.cwd(), MANIFEST_FILENAME)
	const coerced = coerceAbsolutePathDirect(resolved)
	if (!coerced) {
		const message = "Unable to resolve manifest path."
		return {
			error: {
				field: "path",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	return { ok: true, value: coerced }
}

async function assertManifestMissing(
	manifestPath: AbsolutePath,
): Promise<{ ok: true; value: undefined } | { ok: false; error: SkError }> {
	const stats = await safeStat(manifestPath)
	if (!stats.ok) {
		return { error: stats.error, ok: false }
	}

	if (!stats.value) {
		return { ok: true, value: undefined }
	}

	if (!stats.value.isFile()) {
		const message = `Expected file at ${manifestPath}.`
		return {
			error: {
				field: "path",
				message,
				path: manifestPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return {
		error: {
			message: `Manifest already exists at ${manifestPath}.`,
			path: manifestPath,
			target: "manifest",
			type: "conflict",
		},
		ok: false,
	}
}

type AgentSelectionData = { selected: Set<AgentId>; warning?: string }

async function resolveAgentSelection(
	agentList: string | undefined,
	nonInteractive: boolean,
): Promise<CommandResult<AgentSelectionData>> {
	if (agentList !== undefined) {
		const parsed = parseAgentList(agentList)
		if (!parsed.ok) {
			return CommandResult.failed(parsed.error)
		}
		return CommandResult.completed({ selected: parsed.value })
	}

	if (nonInteractive) {
		return CommandResult.completed({ selected: new Set<AgentId>() })
	}

	const agents = listAgents()
	const detectionResult = await getAgentDetectionMap()
	if (!detectionResult.ok) {
		return CommandResult.failed(detectionResult.error)
	}
	const detectionMap = detectionResult.value

	const agentOptions: { label: string; value: AgentId }[] = agents.map((agent) => ({
		label: `${agent.displayName} (${agent.id})`,
		value: agent.id,
	}))

	const detectedAgents = agents
		.filter((agent) => detectionMap[agent.id])
		.map((agent) => agent.id)

	const selected = await multiselect<AgentId>({
		initialValues: detectedAgents,
		message: "Select agents to sync (detected agents are pre-selected)",
		options: agentOptions,
		required: false,
	})

	if (isCancel(selected)) {
		return CommandResult.cancelled()
	}

	const selectedSet = new Set(selected)
	return CommandResult.completed({ selected: selectedSet })
}

function parseAgentList(value: string):
	| {
			ok: true
			value: Set<AgentId>
	  }
	| {
			ok: false
			error: {
				type: "validation"
				field: string
				message: string
				source: "manual"
			}
	  } {
	const raw = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
	if (raw.length === 0) {
		const message = "--agents must include at least one agent id."
		return {
			error: {
				field: "agents",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const valid = new Set<AgentId>()
	for (const agentId of raw) {
		const lookup = getAgentById(agentId)
		if (!lookup.ok) {
			const message = `Unknown agent: ${agentId}. Valid agents: ${listAgents()
				.map((agent) => agent.id)
				.join(", ")}.`
			return {
				error: {
					field: "agents",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		valid.add(lookup.value.id)
	}

	return { ok: true, value: valid }
}

function applyAgentSelection(
	manifest: Manifest,
	selection: AgentSelectionData,
): Manifest {
	let updated = manifest
	for (const agentId of selection.selected) {
		updated = setAgent(updated, agentId, true)
	}

	return updated
}
