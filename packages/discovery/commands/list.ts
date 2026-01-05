import type { Result } from "@skills-supply/core"
import { db } from "@/db"
import { listIndexedPackages } from "@/db/indexed-packages"
import type { DiscoveryError } from "@/types/errors"

export async function listCommand(options: {
	minStars?: number
}): Promise<Result<void, DiscoveryError>> {
	try {
		const rows = await listIndexedPackages(db, { minStars: options.minStars })

		for (const row of rows) {
			const pathValue = row.path ?? ""
			console.log(
				[row.id, row.name, row.github_repo, pathValue, row.gh_stars].join("\t"),
			)
		}
		return { ok: true, value: undefined }
	} catch (error) {
		return {
			error: {
				message: "Failed to list packages.",
				rawError: error instanceof Error ? error : undefined,
				type: "unexpected",
			},
			ok: false,
		}
	} finally {
		await db.destroy()
	}
}
