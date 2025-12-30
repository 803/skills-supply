import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type {
	AgentDefinition,
	AgentDetectionResult,
	AgentId,
	AgentListResult,
	AgentLookupResult,
	AgentRegistryError,
} from "@/core/agents/types"

interface AgentEntry {
	id: AgentId
	displayName: string
	skillsPath: string
	detectPath: string
}

const HOME_DIR = homedir()
const AGENT_ENTRIES: AgentEntry[] = [
	{
		detectPath: path.join(HOME_DIR, ".claude"),
		displayName: "Claude Code",
		id: "claude-code",
		skillsPath: path.join(HOME_DIR, ".claude", "skills"),
	},
	{
		detectPath: path.join(HOME_DIR, ".codex"),
		displayName: "Codex",
		id: "codex",
		skillsPath: path.join(HOME_DIR, ".codex", "skills"),
	},
	{
		detectPath: path.join(HOME_DIR, ".config", "opencode"),
		displayName: "OpenCode",
		id: "opencode",
		skillsPath: path.join(HOME_DIR, ".config", "opencode", "skill"),
	},
]

const AGENT_REGISTRY: AgentDefinition[] = AGENT_ENTRIES.map((entry) => ({
	detect: () => detectAgent(entry.id, entry.detectPath),
	displayName: entry.displayName,
	id: entry.id,
	skillsPath: entry.skillsPath,
}))

const AGENT_IDS = new Set<AgentId>(AGENT_ENTRIES.map((entry) => entry.id))

type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> | null }
	| { ok: false; error: AgentRegistryError }

export function listAgents(): AgentDefinition[] {
	return [...AGENT_REGISTRY]
}

export function getAgentById(agentId: string): AgentLookupResult {
	if (!isAgentId(agentId)) {
		return failure("unknown_agent", `Unknown agent: ${agentId}`, agentId)
	}

	const agent = AGENT_REGISTRY.find((entry) => entry.id === agentId)
	if (!agent) {
		return failure("unknown_agent", `Unknown agent: ${agentId}`, agentId)
	}

	return { ok: true, value: agent }
}

export async function detectInstalledAgents(): Promise<AgentListResult> {
	const installed: AgentDefinition[] = []

	for (const agent of AGENT_REGISTRY) {
		const detected = await agent.detect()
		if (!detected.ok) {
			return detected
		}

		if (detected.value) {
			installed.push(agent)
		}
	}

	return { ok: true, value: installed }
}

function isAgentId(agentId: string): agentId is AgentId {
	return AGENT_IDS.has(agentId as AgentId)
}

async function detectAgent(
	agentId: AgentId,
	detectPath: string,
): Promise<AgentDetectionResult> {
	const statsResult = await safeStat(detectPath)
	if (!statsResult.ok) {
		return statsResult
	}

	if (!statsResult.value) {
		return { ok: true, value: false }
	}

	if (!statsResult.value.isDirectory()) {
		return failure(
			"io_error",
			`Expected directory at ${detectPath}.`,
			agentId,
			detectPath,
		)
	}

	return { ok: true, value: true }
}

async function safeStat(targetPath: string): Promise<StatResult> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to access ${targetPath}.`),
			undefined,
			targetPath,
		)
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

function formatErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return `${fallback} ${error.message}`
	}

	return fallback
}

function failure(
	type: AgentRegistryError["type"],
	message: string,
	agentId?: string,
	pathValue?: string,
): { ok: false; error: AgentRegistryError } {
	return {
		error: {
			agentId,
			message,
			path: pathValue,
			type,
		},
		ok: false,
	}
}
