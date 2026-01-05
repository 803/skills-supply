import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { AbsolutePath } from "@skills-supply/core"
import { isAgentId } from "@skills-supply/core"
import type {
	AgentDefinition,
	AgentDetectionResult,
	AgentId,
	AgentListResult,
	AgentLookupResult,
	AgentRegistryError,
	ResolvedAgent,
} from "@/agents/types"

interface AgentEntry {
	id: AgentId
	displayName: string
	basePath: string
	skillsDir: string
	detectPath: AbsolutePath
}

const HOME_DIR = homedir()
const AGENT_ENTRIES: AgentEntry[] = [
	{
		basePath: ".claude",
		detectPath: path.join(HOME_DIR, ".claude") as AbsolutePath,
		displayName: "Claude Code",
		id: "claude-code",
		skillsDir: "skills",
	},
	{
		basePath: ".codex",
		detectPath: path.join(HOME_DIR, ".codex") as AbsolutePath,
		displayName: "Codex",
		id: "codex",
		skillsDir: "skills",
	},
	{
		basePath: path.join(".config", "opencode"),
		detectPath: path.join(HOME_DIR, ".config", "opencode") as AbsolutePath,
		displayName: "OpenCode",
		id: "opencode",
		skillsDir: "skill",
	},
	{
		basePath: ".factory",
		detectPath: path.join(HOME_DIR, ".factory") as AbsolutePath,
		displayName: "Factory",
		id: "factory",
		skillsDir: "skills",
	},
]

const AGENT_REGISTRY: AgentDefinition[] = AGENT_ENTRIES.map((entry) => ({
	basePath: entry.basePath,
	detect: () => detectAgent(entry.id, entry.detectPath),
	displayName: entry.displayName,
	id: entry.id,
	skillsDir: entry.skillsDir,
}))

type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> | null }
	| { ok: false; error: AgentRegistryError }

export function listAgents(): AgentDefinition[] {
	return [...AGENT_REGISTRY]
}

export function getAgentById(agentId: string): AgentLookupResult {
	if (!isAgentId(agentId)) {
		return {
			error: {
				agentId,
				message: `Unknown agent: ${agentId}`,
				target: "agent",
				type: "not_found",
			},
			ok: false,
		}
	}

	const agent = AGENT_REGISTRY.find((entry) => entry.id === agentId)
	if (!agent) {
		return {
			error: {
				agentId,
				message: `Unknown agent: ${agentId}`,
				target: "agent",
				type: "not_found",
			},
			ok: false,
		}
	}

	return { ok: true, value: agent }
}

export type AgentScope =
	| { type: "local"; projectRoot: AbsolutePath }
	| { type: "global"; homeDir: AbsolutePath }

export function resolveAgent(agent: AgentDefinition, scope: AgentScope): ResolvedAgent {
	const root = scope.type === "local" ? scope.projectRoot : scope.homeDir
	const rootPath = path.join(root, agent.basePath) as AbsolutePath
	return {
		displayName: agent.displayName,
		id: agent.id,
		rootPath,
		skillsPath: path.join(rootPath, agent.skillsDir) as AbsolutePath,
	}
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

async function detectAgent(
	agentId: AgentId,
	detectPath: AbsolutePath,
): Promise<AgentDetectionResult> {
	const statsResult = await safeStat(detectPath)
	if (!statsResult.ok) {
		return statsResult
	}

	if (!statsResult.value) {
		return { ok: true, value: false }
	}

	if (!statsResult.value.isDirectory()) {
		return {
			error: {
				agentId,
				message: `Expected directory at ${detectPath}.`,
				operation: "stat",
				path: detectPath,
				type: "io",
			},
			ok: false,
		}
	}

	return { ok: true, value: true }
}

async function safeStat(targetPath: AbsolutePath): Promise<StatResult> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return {
			error: {
				message: `Unable to access ${targetPath}.`,
				operation: "stat",
				path: targetPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
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
