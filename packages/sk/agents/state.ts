import path from "node:path"
import type { AbsolutePath, Result } from "@skills-supply/core"
import type { ResolvedAgent } from "@/agents/types"
import type { IoError, IoResult } from "@/io/fs"
import { ensureDir, readTextFile, safeStat, writeTextFile } from "@/io/fs"
import type { ParseError, ValidationError } from "@/types/errors"

export interface AgentInstallState {
	version: number
	skills: string[]
	updated_at: string
}

const STATE_FILENAME = ".sk-state.json"
const STATE_VERSION = 1

type AgentStateError = IoError | ParseError | ValidationError

type StateResult = Result<AgentInstallState | null, AgentStateError>

type StateWriteResult = IoResult<void>

export async function readAgentState(agent: ResolvedAgent): Promise<StateResult> {
	const statePath = resolveStatePath(agent)
	const stats = await safeStat(statePath)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: null }
	}

	if (!stats.value.isFile()) {
		return {
			error: {
				message: `Expected file at ${statePath}.`,
				operation: "stat",
				path: statePath,
				type: "io",
			},
			ok: false,
		}
	}

	const contents = await readTextFile(statePath)
	if (!contents.ok) {
		return contents
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(contents.value)
	} catch (error) {
		return {
			error: {
				message: `Invalid JSON in ${statePath}.`,
				path: statePath,
				rawError: error instanceof Error ? error : undefined,
				source: "agent_state",
				type: "parse",
			},
			ok: false,
		}
	}

	const validated = parseState(parsed, statePath)
	if (!validated.ok) {
		return validated
	}

	return { ok: true, value: validated.value }
}

export async function writeAgentState(
	agent: ResolvedAgent,
	state: AgentInstallState,
): Promise<StateWriteResult> {
	const basePath = agent.rootPath
	const ensured = await ensureDir(basePath)
	if (!ensured.ok) {
		return ensured
	}

	const statePath = resolveStatePath(agent)
	const output = JSON.stringify(state, null, 2)
	return writeTextFile(statePath, `${output}\n`)
}

export function buildAgentState(skills: string[]): AgentInstallState {
	const uniqueSkills = Array.from(new Set(skills)).sort()
	return {
		skills: uniqueSkills,
		updated_at: new Date().toISOString(),
		version: STATE_VERSION,
	}
}

export function resolveStatePath(agent: ResolvedAgent): AbsolutePath {
	return path.join(agent.rootPath, STATE_FILENAME) as AbsolutePath
}

function parseState(
	value: unknown,
	statePath: AbsolutePath,
): Result<AgentInstallState, AgentStateError> {
	if (!isRecord(value)) {
		return {
			error: {
				field: "state",
				message: "State file must be a JSON object.",
				path: statePath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const version = value.version
	const skills = value.skills
	const updatedAt = value.updated_at

	if (typeof version !== "number" || !Number.isFinite(version)) {
		return {
			error: {
				field: "version",
				message: "State file version must be a number.",
				path: statePath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (version !== STATE_VERSION) {
		return {
			error: {
				field: "version",
				message: `Unsupported state file version ${version}.`,
				path: statePath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (!Array.isArray(skills) || skills.some((entry) => typeof entry !== "string")) {
		return {
			error: {
				field: "skills",
				message: "State file skills must be an array of strings.",
				path: statePath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	for (const entry of skills) {
		const trimmed = entry.trim()
		if (!trimmed) {
			return {
				error: {
					field: "skills",
					message: "State file skills must not be empty.",
					path: statePath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		if (trimmed === "." || trimmed === "..") {
			return {
				error: {
					field: "skills",
					message: "State file skills contain invalid entries.",
					path: statePath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		if (trimmed.includes("/") || trimmed.includes("\\")) {
			return {
				error: {
					field: "skills",
					message: "State file skills must not include path separators.",
					path: statePath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
	}

	if (typeof updatedAt !== "string" || !updatedAt.trim()) {
		return {
			error: {
				field: "updated_at",
				message: "State file updated_at must be a string.",
				path: statePath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			skills,
			updated_at: updatedAt,
			version,
		},
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
