import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { assertAbsolutePathDirect, type Result } from "@skills-supply/core"
import type { IoError } from "@/types/errors"

const execFileAsync = promisify(execFile)

export async function execGitInDir(
	cwd: string,
	args: string[],
): Promise<Result<{ stdout: string; stderr: string }, IoError>> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		})
		return { ok: true, value: { stderr: String(stderr), stdout: String(stdout) } }
	} catch (error) {
		return {
			error: {
				message: `git ${args.join(" ")} failed.`,
				operation: "execFile",
				path: assertAbsolutePathDirect(cwd),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

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
				path: assertAbsolutePathDirect(options.destination),
				rawError: error instanceof Error ? error : undefined,
				type: "io",
			},
			ok: false,
		}
	}
}

export async function gitAddAll(repoPath: string): Promise<Result<void, IoError>> {
	const result = await execGitInDir(repoPath, ["add", "."])
	if (!result.ok) {
		return result
	}
	return { ok: true, value: undefined }
}

export async function gitDiffStaged(repoPath: string): Promise<Result<string, IoError>> {
	const result = await execGitInDir(repoPath, ["diff", "--staged"])
	if (!result.ok) {
		return result
	}
	return { ok: true, value: result.value.stdout }
}

export async function gitCommit(
	repoPath: string,
	message: string,
): Promise<Result<void, IoError>> {
	const result = await execGitInDir(repoPath, [
		"commit",
		"--no-gpg-sign",
		"-m",
		message,
	])
	if (!result.ok) {
		return result
	}
	return { ok: true, value: undefined }
}

export async function gitPush(
	repoPath: string,
	remote: string,
	branch: string,
): Promise<Result<void, IoError>> {
	const result = await execGitInDir(repoPath, ["push", remote, branch])
	if (!result.ok) {
		return result
	}
	return { ok: true, value: undefined }
}

export async function gitCheckoutNewBranch(
	repoPath: string,
	branchName: string,
): Promise<Result<void, IoError>> {
	const result = await execGitInDir(repoPath, ["checkout", "-b", branchName])
	if (!result.ok) {
		return result
	}
	return { ok: true, value: undefined }
}
