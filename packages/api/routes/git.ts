import { spawn } from "node:child_process"
import { PassThrough, Readable } from "node:stream"
import { Hono } from "hono"
import { authenticateBasic } from "@/services/auth"
import { getMarketplaceRepoPath, resolvePluginRepo } from "@/services/repo-generator"

export const gitRoutes = new Hono()

gitRoutes.get("/me/marketplace.git/info/refs", async (c) => {
	if (c.req.query("service") !== "git-upload-pack") {
		return c.text("Forbidden", 403)
	}

	const user = await authenticateBasic(c.req.header("Authorization"))
	if (!user) {
		c.header("WWW-Authenticate", 'Basic realm="Skills Supply"')
		return c.text("Authentication required", 401)
	}

	const repoPath = await getMarketplaceRepoPath(user)
	return advertiseRefs(repoPath)
})

gitRoutes.get("/u/:creator/:slug.git/info/refs", async (c) => {
	if (c.req.query("service") !== "git-upload-pack") {
		return c.text("Forbidden", 403)
	}

	const creator = c.req.param("creator")
	const slug = c.req.param("slug")
	if (!creator || !slug || !isValidSlug(creator) || !isValidSlug(slug)) {
		return c.text("Invalid repository", 400)
	}

	const user = await authenticateBasic(c.req.header("Authorization"))
	if (!user) {
		c.header("WWW-Authenticate", 'Basic realm="Skills Supply"')
		return c.text("Authentication required", 401)
	}

	try {
		const repo = await resolvePluginRepo(user, creator, slug)
		if (!repo) {
			return c.text("Repository not found", 404)
		}

		return advertiseRefs(repo.repoPath, repo.cleanup)
	} catch (error) {
		console.error("Failed to resolve plugin repo:", error)
		return c.text("Repository not available", 500)
	}
})

gitRoutes.post("/me/marketplace.git/git-upload-pack", async (c) => {
	const user = await authenticateBasic(c.req.header("Authorization"))
	if (!user) {
		c.header("WWW-Authenticate", 'Basic realm="Skills Supply"')
		return c.text("Authentication required", 401)
	}

	const repoPath = await getMarketplaceRepoPath(user)
	return uploadPack(repoPath, c.req.raw)
})

gitRoutes.post("/u/:creator/:slug.git/git-upload-pack", async (c) => {
	const creator = c.req.param("creator")
	const slug = c.req.param("slug")
	if (!creator || !slug || !isValidSlug(creator) || !isValidSlug(slug)) {
		return c.text("Invalid repository", 400)
	}

	const user = await authenticateBasic(c.req.header("Authorization"))
	if (!user) {
		c.header("WWW-Authenticate", 'Basic realm="Skills Supply"')
		return c.text("Authentication required", 401)
	}

	try {
		const repo = await resolvePluginRepo(user, creator, slug)
		if (!repo) {
			return c.text("Repository not found", 404)
		}

		return uploadPack(repo.repoPath, c.req.raw, repo.cleanup)
	} catch (error) {
		console.error("Failed to resolve plugin repo:", error)
		return c.text("Repository not available", 500)
	}
})

function advertiseRefs(repoPath: string, cleanup?: () => Promise<void>): Response {
	const headers = new Headers({
		"Cache-Control": "no-cache",
		"Content-Type": "application/x-git-upload-pack-advertisement",
	})

	const proc = spawn("git", [
		"upload-pack",
		"--stateless-rpc",
		"--advertise-refs",
		repoPath,
	])

	proc.on("error", (error) => {
		console.error("Failed to spawn git upload-pack:", error)
	})

	proc.stderr.on("data", (data) => {
		console.error("git stderr:", data.toString())
	})

	if (cleanup) {
		proc.on("close", () => {
			void cleanup()
		})
	}

	const announcement = "001e# service=git-upload-pack\n0000"
	const stream = new PassThrough()
	stream.write(announcement)
	proc.stdout.pipe(stream)

	const streamBody = Readable.toWeb(stream) as unknown as ReadableStream
	return new Response(streamBody, { headers })
}

async function uploadPack(
	repoPath: string,
	request: Request,
	cleanup?: () => Promise<void>,
): Promise<Response> {
	const headers = new Headers({
		"Cache-Control": "no-cache",
		"Content-Type": "application/x-git-upload-pack-result",
	})

	const body = await request.arrayBuffer()
	const proc = spawn("git", ["upload-pack", "--stateless-rpc", repoPath])

	proc.on("error", (error) => {
		console.error("Failed to spawn git upload-pack:", error)
	})

	proc.stderr.on("data", (data) => {
		console.error("git stderr:", data.toString())
	})

	if (cleanup) {
		proc.on("close", () => {
			void cleanup()
		})
	}

	proc.stdin.write(Buffer.from(body))
	proc.stdin.end()

	const streamBody = Readable.toWeb(proc.stdout) as unknown as ReadableStream
	return new Response(streamBody, { headers })
}

function isValidSlug(slug: string): boolean {
	return /^[a-z0-9][a-z0-9._-]*$/i.test(slug)
}
