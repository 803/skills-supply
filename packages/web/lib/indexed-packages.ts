import {
	formatSkPackageAddCommand,
	parseSerializedDeclaration,
} from "@skills-supply/core/standalone"
import type { Database } from "@skills-supply/database"
import { db } from "@skills-supply/database"
import type { Selectable } from "kysely"

export type IndexedPackage = Selectable<Database["indexed_packages"]>

export async function listIndexedPackages(): Promise<IndexedPackage[]> {
	return db
		.selectFrom("indexed_packages")
		.selectAll()
		.orderBy("gh_stars", "desc")
		.execute()
}

export async function fetchIndexedPackageById(
	id: number,
): Promise<IndexedPackage | undefined> {
	return db
		.selectFrom("indexed_packages")
		.selectAll()
		.where("id", "=", id)
		.executeTakeFirst()
}

export function buildSkInstallCommand(declaration: string): string {
	const parsed = parseSerializedDeclaration(declaration)
	if (!parsed.ok) {
		return `sk add ${declaration}`
	}

	return formatSkPackageAddCommand(parsed.value)
}
