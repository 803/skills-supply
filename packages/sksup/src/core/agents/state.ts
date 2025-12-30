import path from "node:path"
import type { AgentDefinition } from "@/core/agents/types"
import type { IoError, IoResult } from "@/core/io/fs"
import { ensureDir, readTextFile, safeStat, writeTextFile } from "@/core/io/fs"

export interface AgentInstallState {
	version: number
	skills: string[]
	updatedAt: string
}

const STATE_FILENAME = ".sksup-state.json"
const STATE_VERSION = 1

type StateResult = IoResult<AgentInstallState | null>

type StateWriteResult = IoResult<void>

export async function readAgentState(agent: AgentDefinition): Promise<StateResult> {
	const statePath = resolveStatePath(agent)
	const stats = await safeStat(statePath)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true, value: null }
	}

	if (!stats.value.isFile()) {
		return failure(`Expected file at ${statePath}.`, statePath)
	}

	const contents = await readTextFile(statePath)
	if (!contents.ok) {
		return contents
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(contents.value)
	} catch (error) {
		return failure(`Invalid JSON in ${statePath}.`, statePath, error)
	}

	const validated = parseState(parsed, statePath)
	if (!validated.ok) {
		return validated
	}

	return { ok: true, value: validated.value }
}

export async function writeAgentState(
	agent: AgentDefinition,
	state: AgentInstallState,
): Promise<StateWriteResult> {
	const basePath = path.resolve(agent.skillsPath)
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
		updatedAt: new Date().toISOString(),
		version: STATE_VERSION,
	}
}

export function resolveStatePath(agent: AgentDefinition): string {
	return path.join(agent.skillsPath, STATE_FILENAME)
}

function parseState(
	value: unknown,
	statePath: string,
): { ok: true; value: AgentInstallState } | { ok: false; error: IoError } {
	if (!isRecord(value)) {
		return failure(`State file must be a JSON object.`, statePath)
	}

	const version = value.version
	const skills = value.skills
	const updatedAt = value.updatedAt

	if (typeof version !== "number" || !Number.isFinite(version)) {
		return failure("State file version must be a number.", statePath)
	}

	if (version !== STATE_VERSION) {
		return failure(`Unsupported state file version ${version}.`, statePath)
	}

	if (!Array.isArray(skills) || skills.some((entry) => typeof entry !== "string")) {
		return failure("State file skills must be an array of strings.", statePath)
	}

	for (const entry of skills) {
		const trimmed = entry.trim()
		if (!trimmed) {
			return failure("State file skills must not be empty.", statePath)
		}

		if (trimmed === "." || trimmed === "..") {
			return failure("State file skills contain invalid entries.", statePath)
		}

		if (trimmed.includes("/") || trimmed.includes("\\")) {
			return failure(
				"State file skills must not include path separators.",
				statePath,
			)
		}
	}

	if (typeof updatedAt !== "string" || !updatedAt.trim()) {
		return failure("State file updatedAt must be a string.", statePath)
	}

	return {
		ok: true,
		value: {
			skills,
			updatedAt,
			version,
		},
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function failure(
	message: string,
	pathValue: string,
	error?: unknown,
): { ok: false; error: IoError } {
	return {
		error: {
			message: formatErrorMessage(error, message),
			path: pathValue,
			type: "io_error",
		},
		ok: false,
	}
}

function formatErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error) {
		return `${fallback} ${error.message}`
	}

	return fallback
}
