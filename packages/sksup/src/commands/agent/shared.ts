import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { intro, log, note, outro, spinner } from "@clack/prompts"
import { getAgentById } from "@/core/agents/registry"
import type { AgentDefinition } from "@/core/agents/types"
import { parseManifest } from "@/core/manifest/parse"
import type { Manifest } from "@/core/manifest/types"
import { serializeManifest } from "@/core/manifest/write"
import { formatError } from "@/utils/errors"

type AgentAction = "enable" | "disable"

interface AgentUpdateResult {
	action: AgentAction
	agent: AgentDefinition
	changed: boolean
	created: boolean
	manifestPath: string
}

export async function runAgentUpdate(
	agentId: string,
	action: AgentAction,
): Promise<void> {
	intro(`sksup agent ${action === "enable" ? "add" : "remove"}`)

	const actionSpinner = spinner()
	actionSpinner.start("Updating agents...")

	try {
		const result = await updateAgentManifest(agentId, action)
		actionSpinner.stop("Agent settings updated.")

		if (result.created) {
			log.info(`Created ${result.manifestPath}.`)
		}

		const agentLabel = `${result.agent.displayName} (${result.agent.id})`

		if (!result.changed) {
			log.info(`Agent already ${result.action}d: ${agentLabel}.`)
			note(`Manifest: ${result.manifestPath}`, "No changes")
			outro("Done.")
			return
		}

		const actionLabel = result.action === "enable" ? "Enabled" : "Disabled"
		log.success(`${actionLabel} agent: ${agentLabel}.`)
		note(`Manifest: ${result.manifestPath}`, "Updated")
		outro("Done.")
	} catch (error) {
		actionSpinner.stop("Failed to update agents.")
		process.exitCode = 1
		log.error(formatError(error))
		outro("Agent update failed.")
	}
}

async function updateAgentManifest(
	agentId: string,
	action: AgentAction,
): Promise<AgentUpdateResult> {
	const lookup = getAgentById(agentId)
	if (!lookup.ok) {
		throw new Error(lookup.error.message)
	}

	const manifestPath = path.join(process.cwd(), "skills.toml")
	const desired = action === "enable"
	let manifest: Manifest
	let created = false

	try {
		const contents = await readFile(manifestPath, "utf8")
		const parsed = parseManifest(contents, manifestPath)
		if (!parsed.ok) {
			throw new Error(parsed.error.message)
		}

		manifest = parsed.value
	} catch (error) {
		if (isNotFound(error)) {
			if (!desired) {
				throw new Error("skills.toml not found in the current directory.")
			}

			manifest = {
				agents: {},
				packages: {},
				sourcePath: manifestPath,
			}
			created = true
		} else {
			throw error
		}
	}

	const currentValue = manifest.agents[lookup.value.id]
	const changed = currentValue !== desired
	if (changed) {
		manifest.agents[lookup.value.id] = desired
		const serialized = serializeManifest(manifest)
		await writeFile(manifestPath, serialized, "utf8")
	}

	return {
		action,
		agent: lookup.value,
		changed,
		created,
		manifestPath,
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}
