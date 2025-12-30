import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { removePath } from "@/core/io/fs"
import type { IoResult } from "@/core/io/types"
import { ioFailure } from "@/core/io/types"
import { formatError } from "@/utils/errors"

export async function createTempDir(prefix: string): Promise<IoResult<string>> {
	const safePrefix = prefix.endsWith("-") ? prefix : `${prefix}-`
	const base = path.join(tmpdir(), safePrefix)

	try {
		const dir = await mkdtemp(base)
		return { ok: true, value: dir }
	} catch (error) {
		return ioFailure(formatError(error), base, "mkdtemp")
	}
}

export async function cleanupTempDir(targetPath: string): Promise<IoResult<void>> {
	return removePath(targetPath)
}
