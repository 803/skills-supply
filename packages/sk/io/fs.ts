import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AbsolutePath } from "@skills-supply/core"
import type { IoResult } from "@/io/types"

// Re-export types for convenience
export type { IoError, IoResult } from "@/io/types"

type StatResult = IoResult<Awaited<ReturnType<typeof stat>> | null>
type LStatResult = IoResult<Awaited<ReturnType<typeof lstat>> | null>

export async function safeStat(targetPath: string): Promise<StatResult> {
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
				path: toAbsolutePath(targetPath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

export async function safeLstat(targetPath: string): Promise<LStatResult> {
	try {
		const stats = await lstat(targetPath)
		return { ok: true, value: stats }
	} catch (error) {
		if (isNotFound(error)) {
			return { ok: true, value: null }
		}

		return {
			error: {
				message: `Unable to access ${targetPath}.`,
				operation: "lstat",
				path: toAbsolutePath(targetPath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

export async function ensureDir(targetPath: string): Promise<IoResult<void>> {
	const stats = await safeStat(targetPath)
	if (!stats.ok) {
		return stats
	}

	if (stats.value && !stats.value.isDirectory()) {
		return {
			error: {
				message: `Expected directory at ${targetPath}.`,
				operation: "mkdir",
				path: toAbsolutePath(targetPath),
				type: "io",
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
					message: `Unable to create ${targetPath}.`,
					operation: "mkdir",
					path: toAbsolutePath(targetPath),
					rawError: error instanceof Error ? error : undefined,
					type: "io",
				},
				ok: false,
			}
		}
	}

	return { ok: true, value: undefined }
}

export async function readFileUtf8(targetPath: string): Promise<IoResult<string>> {
	try {
		const contents = await readFile(targetPath, "utf8")
		return { ok: true, value: contents }
	} catch (error) {
		return {
			error: {
				message: `Unable to read ${targetPath}.`,
				operation: "readFile",
				path: toAbsolutePath(targetPath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

export async function readTextFile(targetPath: string): Promise<IoResult<string>> {
	return readFileUtf8(targetPath)
}

export async function writeFileUtf8(
	targetPath: string,
	contents: string,
): Promise<IoResult<void>> {
	try {
		await writeFile(targetPath, contents, "utf8")
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: `Unable to write ${targetPath}.`,
				operation: "writeFile",
				path: toAbsolutePath(targetPath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

export async function writeTextFile(
	targetPath: string,
	contents: string,
): Promise<IoResult<void>> {
	return writeFileUtf8(targetPath, contents)
}

export async function removePath(targetPath: string): Promise<IoResult<void>> {
	try {
		await rm(targetPath, { force: true, recursive: true })
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: `Unable to remove ${targetPath}.`,
				operation: "rm",
				path: toAbsolutePath(targetPath),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

function toAbsolutePath(value: string): AbsolutePath {
	const resolved = path.isAbsolute(value) ? path.normalize(value) : path.resolve(value)
	return resolved as AbsolutePath
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: string }).code === "ENOENT"
	)
}
