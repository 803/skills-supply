import type { SyncResult, SyncStage } from "@/sync/types"
import type { SkError } from "@/types/errors"

export function failSync(stage: SyncStage, error: SkError): SyncResult<never> {
	return {
		error: {
			...error,
			cause: error,
			message: `Sync failed at ${stage}.`,
			stage,
		},
		ok: false,
	}
}
