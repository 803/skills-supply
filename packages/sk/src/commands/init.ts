import { homedir } from "node:os"
import path from "node:path"
import { isCancel, multiselect } from "@clack/prompts"
import { consola } from "consola"
import {
	detectInstalledAgents,
	getAgentById,
	listAgents,
} from "@/src/core/agents/registry"
import { ensureDir, safeStat } from "@/src/core/io/fs"
import { createEmptyManifest, saveManifest } from "@/src/core/manifest/fs"
import { setAgent } from "@/src/core/manifest/transform"
import type { Manifest } from "@/src/core/manifest/types"
import type { AbsolutePath, AgentId } from "@/src/core/types/branded"
import { coerceAbsolutePathDirect } from "@/src/core/types/coerce"
import { formatError } from "@/src/utils/errors"

export async function initCommand(options: {
	agents?: string
	global: boolean
	nonInteractive: boolean
}): Promise<void> {
	consola.info("sk init")

	try {
		const manifestPath = resolveManifestPath(options.global)
		await assertManifestMissing(manifestPath)

		let manifest = createEmptyManifest(
			manifestPath,
			options.global ? "sk-global" : "cwd",
		)

		const agentSelection = await resolveAgentSelection(
			options.agents,
			options.nonInteractive,
		)
		if (agentSelection.canceled) {
			consola.info("Canceled.")
			return
		}

		manifest = applyAgentSelection(manifest, agentSelection)
		const ensured = await ensureDir(path.dirname(manifestPath))
		if (!ensured.ok) {
			throw new Error(ensured.error.message)
		}
		const includeEmptyAgents = options.agents !== undefined || !options.nonInteractive
		await saveManifest(manifest, manifestPath, {
			includeEmptyAgents,
			includeEmptyDependencies: true,
		})

		consola.success("Manifest created.")
		consola.info(`Manifest: ${manifestPath}`)
		if (agentSelection.warning) {
			consola.warn(agentSelection.warning)
		}
		consola.success("Done.")
	} catch (error) {
		process.exitCode = 1
		consola.error(formatError(error))
		consola.error("Init failed.")
	}
}

function resolveManifestPath(useGlobal: boolean): AbsolutePath {
	const resolved = useGlobal
		? path.join(homedir(), ".sk", "agents.toml")
		: path.join(process.cwd(), "agents.toml")
	const coerced = coerceAbsolutePathDirect(resolved)
	if (!coerced) {
		throw new Error("Unable to resolve manifest path.")
	}
	return coerced
}

async function assertManifestMissing(manifestPath: AbsolutePath): Promise<void> {
	const stats = await safeStat(manifestPath)
	if (!stats.ok) {
		throw new Error(stats.error.message)
	}

	if (!stats.value) {
		return
	}

	if (!stats.value.isFile()) {
		throw new Error(`Expected file at ${manifestPath}.`)
	}

	throw new Error(`Manifest already exists at ${manifestPath}.`)
}

type AgentSelectionResult =
	| { canceled: true }
	| {
			canceled: false
			selected: Set<AgentId>
			warning?: string
	  }

async function resolveAgentSelection(
	agentList: string | undefined,
	nonInteractive: boolean,
): Promise<AgentSelectionResult> {
	if (agentList !== undefined) {
		const parsed = parseAgentList(agentList)
		return {
			canceled: false,
			selected: parsed,
		}
	}

	if (nonInteractive) {
		return {
			canceled: false,
			selected: new Set<AgentId>(),
		}
	}

	const detected = await detectInstalledAgents()
	if (!detected.ok) {
		throw new Error(detected.error.message)
	}

	if (detected.value.length === 0) {
		return {
			canceled: false,
			selected: new Set<AgentId>(),
			warning:
				"No installed agents detected; created manifest with empty [agents].",
		}
	}

	const agentOptions: { label: string; value: AgentId }[] = detected.value.map(
		(agent) => ({
			label: `${agent.displayName} (${agent.id})`,
			value: agent.id,
		}),
	)

	const selected = await multiselect<{ label: string; value: AgentId }[], AgentId>({
		initialValues: [],
		message: "Select enabled agents",
		options: agentOptions,
		required: false,
	})

	if (isCancel(selected)) {
		return { canceled: true }
	}

	const selectedSet = new Set(selected)
	return { canceled: false, selected: selectedSet }
}

function parseAgentList(value: string): Set<AgentId> {
	const raw = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
	if (raw.length === 0) {
		throw new Error("--agents must include at least one agent id.")
	}

	const valid = new Set<AgentId>()
	for (const agentId of raw) {
		const lookup = getAgentById(agentId)
		if (!lookup.ok) {
			throw new Error(
				`Unknown agent: ${agentId}. Valid agents: ${listAgents()
					.map((agent) => agent.id)
					.join(", ")}.`,
			)
		}
		valid.add(lookup.value.id)
	}

	return valid
}

function applyAgentSelection(
	manifest: Manifest,
	selection: AgentSelectionResult,
): Manifest {
	if (selection.canceled) {
		return manifest
	}

	let updated = manifest
	for (const agentId of selection.selected) {
		updated = setAgent(updated, agentId, true)
	}

	return updated
}
