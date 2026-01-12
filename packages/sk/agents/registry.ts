import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
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

const execFileAsync = promisify(execFile)

// =============================================================================
// Agent Entry Configuration
// =============================================================================

interface AgentEntry {
	id: AgentId
	displayName: string
	localBasePath: string
	globalBasePath: string
	skillsDir: string
	detectCommand: {
		binary: string
		args: string[]
		timeoutMs: number
	}
}

const DEFAULT_TIMEOUT_MS = 5000

const AGENT_ENTRIES: AgentEntry[] = [
	{
		detectCommand: {
			args: ["--version"],
			binary: "amp",
			timeoutMs: DEFAULT_TIMEOUT_MS,
		},
		displayName: "Amp",
		globalBasePath: path.join(".config", "agents"),
		id: "amp",
		localBasePath: ".agents",
		skillsDir: "skills",
	},
	{
		detectCommand: {
			args: ["--version"],
			binary: "claude",
			timeoutMs: DEFAULT_TIMEOUT_MS,
		},
		displayName: "Claude Code",
		globalBasePath: ".claude",
		id: "claude-code",
		localBasePath: ".claude",
		skillsDir: "skills",
	},
	{
		detectCommand: {
			args: ["--version"],
			binary: "codex",
			timeoutMs: DEFAULT_TIMEOUT_MS,
		},
		displayName: "Codex",
		globalBasePath: ".codex",
		id: "codex",
		localBasePath: ".codex",
		skillsDir: "skills",
	},
	{
		detectCommand: {
			args: ["--version"],
			binary: "droid",
			timeoutMs: DEFAULT_TIMEOUT_MS,
		},
		displayName: "Factory",
		globalBasePath: ".factory",
		id: "factory",
		localBasePath: ".factory",
		skillsDir: "skills",
	},
	{
		detectCommand: {
			args: ["--version"],
			binary: "opencode",
			timeoutMs: DEFAULT_TIMEOUT_MS,
		},
		displayName: "OpenCode",
		globalBasePath: path.join(".config", "opencode"),
		id: "opencode",
		localBasePath: ".opencode",
		skillsDir: "skill",
	},
]

// =============================================================================
// Agent Registry
// =============================================================================

const AGENT_REGISTRY: AgentDefinition[] = AGENT_ENTRIES.map((entry) => ({
	detect: () => detectAgentCli(entry.id, entry.detectCommand),
	displayName: entry.displayName,
	globalBasePath: entry.globalBasePath,
	id: entry.id,
	localBasePath: entry.localBasePath,
	skillsDir: entry.skillsDir,
}))

export function listAgents(): AgentDefinition[] {
	return [...AGENT_REGISTRY]
}

export function getAgentById(agentId: string): AgentLookupResult {
	const agent = isAgentId(agentId)
		? AGENT_REGISTRY.find((entry) => entry.id === agentId)
		: undefined

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

// =============================================================================
// Agent Resolution
// =============================================================================

export type AgentScope =
	| { type: "local"; projectRoot: AbsolutePath }
	| { type: "global"; homeDir: AbsolutePath }

export function resolveAgent(agent: AgentDefinition, scope: AgentScope): ResolvedAgent {
	const root = scope.type === "local" ? scope.projectRoot : scope.homeDir
	const basePath = scope.type === "local" ? agent.localBasePath : agent.globalBasePath
	const rootPath = path.join(root, basePath) as AbsolutePath
	return {
		displayName: agent.displayName,
		id: agent.id,
		rootPath,
		skillsPath: path.join(rootPath, agent.skillsDir) as AbsolutePath,
	}
}

// =============================================================================
// Agent Detection
// =============================================================================

export async function detectInstalledAgents(): Promise<AgentListResult> {
	const detectionMap = await getAgentDetectionMap()
	if (!detectionMap.ok) {
		return detectionMap
	}

	const installed = AGENT_REGISTRY.filter((agent) => detectionMap.value[agent.id])
	return { ok: true, value: installed }
}

export type AgentDetectionMap = Record<AgentId, boolean>
export type AgentDetectionMapResult =
	| { ok: true; value: AgentDetectionMap }
	| { ok: false; error: AgentRegistryError }

export async function getAgentDetectionMap(): Promise<AgentDetectionMapResult> {
	// Run all detections in parallel
	const detections = await Promise.all(
		AGENT_REGISTRY.map(async (agent) => {
			const result = await agent.detect()
			return { agentId: agent.id, result }
		}),
	)

	// Aggregate results - if any agent fails to detect, treat as not installed
	const result: Partial<AgentDetectionMap> = {}
	for (const { agentId, result: detection } of detections) {
		result[agentId] = detection.ok ? detection.value : false
	}

	return { ok: true, value: result as AgentDetectionMap }
}

// =============================================================================
// CLI Detection Implementation
// =============================================================================

type DetectCommand = AgentEntry["detectCommand"]

async function detectAgentCli(
	_agentId: AgentId,
	command: DetectCommand,
): Promise<AgentDetectionResult> {
	try {
		await execFileAsync(command.binary, command.args, {
			timeout: command.timeoutMs,
		})
		return { ok: true, value: true }
	} catch (error) {
		// Command not found - agent CLI not installed
		if (isCommandNotFound(error)) {
			return { ok: true, value: false }
		}

		// Timeout - treat as not detected (CLI may be broken/hanging)
		if (isTimeoutError(error)) {
			return { ok: true, value: false }
		}

		// Non-zero exit code or any other error - treat as not detected
		return { ok: true, value: false }
	}
}

function isCommandNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}

function isTimeoutError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"killed" in error &&
		(error as { killed?: boolean }).killed === true &&
		"signal" in error &&
		(error as { signal?: string }).signal === "SIGTERM"
	)
}
