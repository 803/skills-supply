import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { Result } from "@skills-supply/core"
import type { IoError } from "@/types/errors"

const execFileAsync = promisify(execFile)

export async function cloneRemoteRepo(options: {
	remoteUrl: string
	destination: string
}): Promise<Result<{ repoPath: string }, IoError>> {
	try {
		await mkdir(path.dirname(options.destination), { recursive: true })
		await execFileAsync(
			"git",
			["clone", "--depth", "1", options.remoteUrl, options.destination],
			{ env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
		)
		return { ok: true, value: { repoPath: options.destination } }
	} catch (error) {
		return {
			error: {
				message: "git clone failed.",
				operation: "execFile",
				path: options.destination,
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}
