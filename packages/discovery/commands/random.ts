import type { Result } from "@skills-supply/core"
import {
	formatSkPackageAddCommand,
	parseSerializedDeclaration,
} from "@skills-supply/core"
import { db } from "@/db"
import { getRandomIndexedPackage } from "@/db/indexed-packages"
import type { DiscoveryError } from "@/types/errors"

export async function randomCommand(): Promise<Result<void, DiscoveryError>> {
	try {
		const pkg = await getRandomIndexedPackage(db)
		if (!pkg) {
			return {
				error: {
					message: "No packages found in the index.",
					target: "package",
					type: "not_found",
				},
				ok: false,
			}
		}

		const parsed = parseSerializedDeclaration(pkg.declaration)
		if (!parsed.ok) {
			return {
				error: {
					field: "declaration",
					message: `Invalid declaration for package ${pkg.id}: ${parsed.error.message}`,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		console.log(formatSkPackageAddCommand(parsed.value))
		return { ok: true, value: undefined }
	} finally {
		await db.destroy()
	}
}
