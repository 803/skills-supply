import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import type { IoError, IoResult } from "@/core/io/types"
import { ioFailure } from "@/core/io/types"
import { formatError } from "@/utils/errors"

// Re-export types for convenience
export type { IoError, IoResult } from "@/core/io/types"

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

		return ioFailure(formatError(error), targetPath, "stat")
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

		return ioFailure(formatError(error), targetPath, "lstat")
	}
}

export async function ensureDir(targetPath: string): Promise<IoResult<void>> {
	const stats = await safeStat(targetPath)
	if (!stats.ok) {
		return stats
	}

	if (stats.value && !stats.value.isDirectory()) {
		return ioFailure(`Expected directory at ${targetPath}.`, targetPath, "mkdir")
	}

	if (!stats.value) {
		try {
			await mkdir(targetPath, { recursive: true })
		} catch (error) {
			return ioFailure(formatError(error), targetPath, "mkdir")
		}
	}

	return { ok: true, value: undefined }
}

export async function readFileUtf8(targetPath: string): Promise<IoResult<string>> {
	try {
		const contents = await readFile(targetPath, "utf8")
		return { ok: true, value: contents }
	} catch (error) {
		return ioFailure(formatError(error), targetPath, "readFile")
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
		return ioFailure(formatError(error), targetPath, "writeFile")
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
		return ioFailure(formatError(error), targetPath, "rm")
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
