import type { Result } from "@skills-supply/core"
import { sql } from "kysely"
import { table } from "table"
import { db } from "@/db"
import type { DiscoveryError } from "@/types/errors"

export async function statsCommand(): Promise<Result<void, DiscoveryError>> {
	try {
		// Queue stats
		const queueRows = await sql<{ state: string; count: string }>`
			SELECT state, COUNT(*) as count
			FROM pgboss.job
			WHERE name = 'discovery'
			GROUP BY state
			ORDER BY state
		`.execute(db)

		console.log("\n Queue Stats\n")
		const queueData = [
			["State", "Count"],
			...queueRows.rows.map((r) => [r.state, r.count]),
		]
		console.log(table(queueData))

		// Stars histogram
		const rows = await db
			.selectFrom("indexed_packages")
			.select([
				sql<number>`ROUND(gh_stars / 100.0) * 100`.as("bucket"),
				sql<number>`COUNT(*)`.as("packages"),
				sql<number>`COUNT(DISTINCT gh_repo)`.as("repos"),
			])
			.groupBy(sql`ROUND(gh_stars / 100.0) * 100`)
			.orderBy("bucket", "asc")
			.execute()

		console.log(" Stars Histogram (filtered packages)\n")

		let totalPkgs = 0
		let totalRepos = 0
		const histData: (string | number)[][] = [["Stars", "Pkgs", "Repos"]]
		for (const row of rows) {
			const bucket = Number(row.bucket)
			const packages = Number(row.packages)
			const repos = Number(row.repos)
			totalPkgs += packages
			totalRepos += repos
			histData.push([bucket, packages, repos])
		}
		histData.push(["Total", totalPkgs, totalRepos])

		console.log(table(histData))

		return { ok: true, value: undefined }
	} finally {
		await db.destroy()
	}
}
