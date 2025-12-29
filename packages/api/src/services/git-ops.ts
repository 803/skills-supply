import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

export type FileMap = Record<string, string>

const COMMIT_IDENTITY = {
	GIT_AUTHOR_EMAIL: "noreply@skills.supply",
	GIT_AUTHOR_NAME: "Skills Supply",
	GIT_COMMITTER_EMAIL: "noreply@skills.supply",
	GIT_COMMITTER_NAME: "Skills Supply",
}

export async function ensureBareRepo(repoPath: string): Promise<void> {
	const exists = await fs
		.stat(repoPath)
		.then(() => true)
		.catch(() => false)

	if (!exists) {
		await fs.mkdir(repoPath, { recursive: true })
		execFileSync("git", ["init", "--bare", repoPath])
	}
}

export async function addCommit(
	repoPath: string,
	files: FileMap,
	parentSha: string | null,
): Promise<void> {
	const worktree = await fs.mkdtemp(path.join(tmpdir(), "sksup-worktree-"))
	try {
		await writeFiles(worktree, files)

		const env = {
			...process.env,
			...COMMIT_IDENTITY,
			GIT_DIR: repoPath,
			GIT_WORK_TREE: worktree,
		}

		execFileSync("git", ["add", "-A"], { cwd: worktree, env })

		const treeSha = execFileSync("git", ["write-tree"], { env }).toString().trim()

		const commitArgs = ["commit-tree", treeSha]
		if (parentSha) {
			commitArgs.push("-p", parentSha)
		}
		commitArgs.push("-m", "Update content")

		const commitSha = execFileSync("git", commitArgs, { env }).toString().trim()

		execFileSync("git", ["update-ref", "refs/heads/main", commitSha], {
			env,
		})
		execFileSync("git", ["symbolic-ref", "HEAD", "refs/heads/main"], {
			env,
		})
	} finally {
		await fs.rm(worktree, { force: true, recursive: true })
	}
}

export function getHeadSha(repoPath: string): string {
	return execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"]).toString().trim()
}

async function writeFiles(root: string, files: FileMap): Promise<void> {
	for (const [relativePath, contents] of Object.entries(files)) {
		const fullPath = path.join(root, relativePath)
		await fs.mkdir(path.dirname(fullPath), { recursive: true })
		await fs.writeFile(fullPath, contents)
	}
}
