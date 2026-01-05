import { cp, lstat, mkdir, rm, stat, symlink } from "node:fs/promises"
import path from "node:path"
import type { AbsolutePath } from "@skills-supply/core"
import type {
	AgentInstallError,
	AgentInstallResult,
	InstallablePackage,
	InstalledSkill,
	ResolvedAgent,
} from "@/agents/types"

type InstallMode = "copy" | "symlink"

export interface InstallTask {
	agentId: ResolvedAgent["id"]
	sourcePath: AbsolutePath
	targetName: string
	targetPath: AbsolutePath
	skillName: string
	mode: InstallMode
}

export interface AgentInstallPlan {
	agentId: ResolvedAgent["id"]
	basePath: AbsolutePath
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
	agent: ResolvedAgent,
	packages: InstallablePackage[],
): PlanResult {
	// Validate raw input before resolving - empty/whitespace paths are invalid
	if (!agent.skillsPath.trim()) {
		const message = "Agent skills path cannot be empty."
		return {
			error: {
				agentId: agent.id,
				field: "skillsPath",
				message,
				path: agent.skillsPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	const basePath = agent.skillsPath

	const tasks: InstallTask[] = []
	const seenTargets = new Set<string>()
	const baseNormalized = path.resolve(basePath) as AbsolutePath

	for (const pkg of packages) {
		if (pkg.skills.length === 0) {
			const message = `Package "${pkg.prefix}" has no skills to install.`
			return {
				error: {
					agentId: agent.id,
					field: "skills",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
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
			const targetPath = path.join(baseNormalized, targetName) as AbsolutePath
			if (!isWithinBase(baseNormalized, targetPath)) {
				const message = "Skill target path escapes the agent skills directory."
				return {
					error: {
						agentId: agent.id,
						field: "targetPath",
						message,
						path: targetPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			if (seenTargets.has(targetPath)) {
				return {
					error: {
						agentId: agent.id,
						message: `Duplicate target path detected: ${targetName}`,
						path: targetPath,
						target: "targetPath",
						type: "conflict",
					},
					ok: false,
				}
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
	agentId: ResolvedAgent["id"],
): { ok: true; value: string } | { ok: false; error: AgentInstallError } {
	const trimmed = value.trim()
	if (!trimmed) {
		const message = `Skill ${label} cannot be empty.`
		return {
			error: {
				agentId,
				field: label,
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (trimmed.includes("/") || trimmed.includes("\\")) {
		const message = `Skill ${label} must not include path separators.`
		return {
			error: {
				agentId,
				field: label,
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (trimmed === "." || trimmed === "..") {
		const message = `Skill ${label} must not be "." or "..".`
		return {
			error: {
				agentId,
				field: label,
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: trimmed }
}

function isWithinBase(basePath: string, targetPath: string): boolean {
	const relative = path.relative(basePath, targetPath)
	return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
}

async function ensureDirectory(
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	const stats = await safeStat(targetPath, agentId)
	if (!stats.ok) {
		return stats
	}

	if (stats.value && !stats.value.isDirectory()) {
		const message = `Expected directory at ${targetPath}.`
		return {
			error: {
				agentId,
				field: "targetPath",
				message,
				path: targetPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (!stats.value) {
		try {
			await mkdir(targetPath, { recursive: true })
		} catch (error) {
			return {
				error: {
					agentId,
					message: `Unable to create ${targetPath}.`,
					operation: "mkdir",
					path: targetPath,
					rawError: error instanceof Error ? error : undefined,
					type: "io",
				},
				ok: false,
			}
		}
	}

	return { ok: true }
}

async function ensureExistingDirectory(
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	const stats = await safeStat(targetPath, agentId)
	if (!stats.ok) {
		return stats
	}

	if (!stats.value) {
		const message = `Skill source path does not exist: ${targetPath}`
		return {
			error: {
				agentId,
				field: "sourcePath",
				message,
				path: targetPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (!stats.value.isDirectory()) {
		const message = `Skill source path is not a directory: ${targetPath}`
		return {
			error: {
				agentId,
				field: "sourcePath",
				message,
				path: targetPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true }
}

async function prepareTarget(
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
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
		return {
			error: {
				agentId,
				message: `Target path already exists: ${targetPath}`,
				path: targetPath,
				target: "targetPath",
				type: "conflict",
			},
			ok: false,
		}
	}

	return removeTarget(targetPath, agentId)
}

async function validateTargets(
	tasks: InstallTask[],
	agentId: ResolvedAgent["id"],
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
			return {
				error: {
					agentId,
					message: `Target path already exists: ${task.targetPath}`,
					path: task.targetPath,
					target: "targetPath",
					type: "conflict",
				},
				ok: false,
			}
		}
	}

	return { ok: true }
}

async function removeTarget(
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	try {
		await rm(targetPath, { force: true, recursive: true })
		return { ok: true }
	} catch (error) {
		return {
			error: {
				agentId,
				message: `Unable to remove ${targetPath}.`,
				operation: "rm",
				path: targetPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function copyDirectory(
	sourcePath: AbsolutePath,
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	try {
		await cp(sourcePath, targetPath, { recursive: true })
		return { ok: true }
	} catch (error) {
		return {
			error: {
				agentId,
				message: `Unable to copy ${sourcePath} to ${targetPath}.`,
				operation: "cp",
				path: targetPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function createSymlink(
	sourcePath: AbsolutePath,
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
): Promise<{ ok: true } | { ok: false; error: AgentInstallError }> {
	try {
		const linkType = process.platform === "win32" ? "junction" : "dir"
		await symlink(sourcePath, targetPath, linkType)
		return { ok: true }
	} catch (error) {
		return {
			error: {
				agentId,
				message: `Unable to symlink ${targetPath}.`,
				operation: "symlink",
				path: targetPath,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

async function safeStat(
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
): Promise<StatResult> {
	try {
		const stats = await stat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return {
			error: {
				agentId,
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

async function safeLstat(
	targetPath: AbsolutePath,
	agentId: ResolvedAgent["id"],
): Promise<LStatResult> {
	try {
		const stats = await lstat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return {
			error: {
				agentId,
				message: `Unable to access ${targetPath}.`,
				operation: "lstat",
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
