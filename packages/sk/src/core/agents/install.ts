import { cp, lstat, mkdir, rm, stat, symlink } from "node:fs/promises"
import path from "node:path"
import type {
	AgentDefinition,
	AgentInstallError,
	AgentInstallResult,
	InstallablePackage,
	InstalledSkill,
} from "@/core/agents/types"

type InstallMode = "copy" | "symlink"

export interface InstallTask {
	agentId: AgentDefinition["id"]
	sourcePath: string
	targetName: string
	targetPath: string
	skillName: string
	mode: InstallMode
}

export interface AgentInstallPlan {
	agentId: AgentDefinition["id"]
	basePath: string
	tasks: InstallTask[]
}

export interface InstallGuard {
	trackedPaths: Set<string>
}

type PlanResult =
	| { ok: true; value: AgentInstallPlan }
	| { ok: false; error: AgentInstallError }

type StatResult =
	| { ok: true; value: Awaited<ReturnType<typeof stat>> | null }
	| { ok: false; error: AgentInstallError }

type LStatResult =
	| { ok: true; value: Awaited<ReturnType<typeof lstat>> | null }
	| { ok: false; error: AgentInstallError }

export async function applyAgentInstall(
	plan: AgentInstallPlan,
	guard?: InstallGuard,
): Promise<AgentInstallResult> {
	const { basePath, tasks } = plan
	const baseReady = await ensureDirectory(basePath, plan.agentId)
	if (!baseReady.ok) {
		return baseReady
	}

	const preflight = await validateTargets(tasks, plan.agentId, guard)
	if (!preflight.ok) {
		return preflight
	}

	const installed: InstalledSkill[] = []

	for (const task of tasks) {
		const sourceReady = await ensureExistingDirectory(task.sourcePath, plan.agentId)
		if (!sourceReady.ok) {
			return sourceReady
		}

		const targetReady = await prepareTarget(task.targetPath, plan.agentId, guard)
		if (!targetReady.ok) {
			return targetReady
		}

		const installResult =
			task.mode === "symlink"
				? await createSymlink(task.sourcePath, task.targetPath, plan.agentId)
				: await copyDirectory(task.sourcePath, task.targetPath, plan.agentId)
		if (!installResult.ok) {
			return installResult
		}

		installed.push({
			agentId: plan.agentId,
			name: task.skillName,
			sourcePath: task.sourcePath,
			targetPath: task.targetPath,
		})
	}

	return { ok: true, value: installed }
}

export function planAgentInstall(
	agent: AgentDefinition,
	packages: InstallablePackage[],
): PlanResult {
	const basePath = path.resolve(agent.skillsPath)
	if (!basePath.trim()) {
		return failure(
			"invalid_target",
			"Agent skills path cannot be empty.",
			agent.id,
			agent.skillsPath,
		)
	}

	const tasks: InstallTask[] = []
	const seenTargets = new Set<string>()
	const baseNormalized = path.resolve(basePath)

	for (const pkg of packages) {
		if (pkg.skills.length === 0) {
			return failure(
				"invalid_input",
				`Package "${pkg.prefix}" has no skills to install.`,
				agent.id,
			)
		}

		const prefixResult = normalizeSegment(pkg.prefix, "prefix", agent.id)
		if (!prefixResult.ok) {
			return prefixResult
		}

		const mode: InstallMode = pkg.canonical.type === "local" ? "symlink" : "copy"

		for (const skill of pkg.skills) {
			const skillResult = normalizeSegment(skill.name, "skill name", agent.id)
			if (!skillResult.ok) {
				return skillResult
			}

			const targetName = `${prefixResult.value}-${skillResult.value}`
			const targetPath = path.join(baseNormalized, targetName)
			if (!isWithinBase(baseNormalized, targetPath)) {
				return failure(
					"invalid_target",
					"Skill target path escapes the agent skills directory.",
					agent.id,
					targetPath,
				)
			}

			if (seenTargets.has(targetPath)) {
				return failure(
					"conflict",
					`Duplicate target path detected: ${targetName}`,
					agent.id,
					targetPath,
				)
			}

			seenTargets.add(targetPath)
			tasks.push({
				agentId: agent.id,
				mode,
				skillName: skillResult.value,
				sourcePath: skill.sourcePath,
				targetName,
				targetPath,
			})
		}
	}

	return { ok: true, value: { agentId: agent.id, basePath: baseNormalized, tasks } }
}

function normalizeSegment(
	value: string,
	label: string,
	agentId: AgentDefinition["id"],
): { ok: true; value: string } | { ok: false; error: AgentInstallError } {
	const trimmed = value.trim()
	if (!trimmed) {
		return failure("invalid_input", `Skill ${label} cannot be empty.`, agentId)
	}

	if (trimmed.includes("/") || trimmed.includes("\\")) {
		return failure(
			"invalid_input",
			`Skill ${label} must not include path separators.`,
			agentId,
		)
	}

	if (trimmed === "." || trimmed === "..") {
		return failure(
			"invalid_input",
			`Skill ${label} must not be "." or "..".`,
			agentId,
		)
	}

	return { ok: true, value: trimmed }
}

function isWithinBase(basePath: string, targetPath: string): boolean {
	const relative = path.relative(basePath, targetPath)
	return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function ensureDirectory(
	targetPath: string,
	agentId: AgentDefinition["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	const stats = await safeStat(targetPath, agentId)
	if (!stats.ok) {
		return stats
	}

	if (stats.value && !stats.value.isDirectory()) {
		return failure(
			"invalid_target",
			`Expected directory at ${targetPath}.`,
			agentId,
			targetPath,
		)
	}

	if (!stats.value) {
		try {
			await mkdir(targetPath, { recursive: true })
		} catch (error) {
			return failure(
				"io_error",
				formatErrorMessage(error, `Unable to create ${targetPath}.`),
				agentId,
				targetPath,
			)
		}
	}

	return { ok: true }
}

async function ensureExistingDirectory(
	targetPath: string,
	agentId: AgentDefinition["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	const stats = await safeStat(targetPath, agentId)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return failure(
			"invalid_input",
			`Skill source path does not exist: ${targetPath}`,
			agentId,
			targetPath,
		)
	}

	if (!stats.value.isDirectory()) {
		return failure(
			"invalid_input",
			`Skill source path is not a directory: ${targetPath}`,
			agentId,
			targetPath,
		)
	}

	return { ok: true }
}

async function prepareTarget(
	targetPath: string,
	agentId: AgentDefinition["id"],
	guard?: InstallGuard,
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	const stats = await safeLstat(targetPath, agentId)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		return { ok: true }
	}

	if (!guard || !guard.trackedPaths.has(targetPath)) {
		return failure(
			"conflict",
			`Target path already exists: ${targetPath}`,
			agentId,
			targetPath,
		)
	}

	return removeTarget(targetPath, agentId)
}

async function validateTargets(
	tasks: InstallTask[],
	agentId: AgentDefinition["id"],
	guard?: InstallGuard,
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	for (const task of tasks) {
		const stats = await safeLstat(task.targetPath, agentId)
		if (!stats.ok) {
			return stats
		}

		if (!stats.value) {
			continue
		}

		if (!guard || !guard.trackedPaths.has(task.targetPath)) {
			return failure(
				"conflict",
				`Target path already exists: ${task.targetPath}`,
				agentId,
				task.targetPath,
			)
		}
	}

	return { ok: true }
}

async function removeTarget(
	targetPath: string,
	agentId: AgentDefinition["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	try {
		await rm(targetPath, { force: true, recursive: true })
		return { ok: true }
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to remove ${targetPath}.`),
			agentId,
			targetPath,
		)
	}
}

async function copyDirectory(
	sourcePath: string,
	targetPath: string,
	agentId: AgentDefinition["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	try {
		await cp(sourcePath, targetPath, { recursive: true })
		return { ok: true }
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to copy ${sourcePath} to ${targetPath}.`),
			agentId,
			targetPath,
		)
	}
}

async function createSymlink(
	sourcePath: string,
	targetPath: string,
	agentId: AgentDefinition["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	try {
		const linkType = process.platform === "win32" ? "junction" : "dir"
		await symlink(sourcePath, targetPath, linkType)
		return { ok: true }
	} catch (error) {
		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to symlink ${targetPath}.`),
			agentId,
			targetPath,
		)
	}
}

async function safeStat(
	targetPath: string,
	agentId: AgentDefinition["id"],
): Promise<StatResult> {
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
			agentId,
			targetPath,
		)
	}
}

async function safeLstat(
	targetPath: string,
	agentId: AgentDefinition["id"],
): Promise<LStatResult> {
	try {
		const stats = await lstat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return failure(
			"io_error",
			formatErrorMessage(error, `Unable to access ${targetPath}.`),
			agentId,
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
	type: AgentInstallError["type"],
	message: string,
	agentId: AgentDefinition["id"],
	pathValue?: string,
): { ok: false; error: AgentInstallError } {
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
