import type { SyncError, SyncResult, SyncStage } from "@/src/core/sync/types"

export function failSync(
	stage: SyncStage,
	error: unknown,
	fallbackMessage?: string,
): SyncResult<never> {
	return { error: toSyncError(stage, error, fallbackMessage), ok: false }
}

export function toSyncError(
	stage: SyncStage,
	error: unknown,
	fallbackMessage?: string,
): SyncError {
	return {
		details: error,
		message: resolveMessage(error, fallbackMessage),
		stage,
	}
}

function resolveMessage(error: unknown, fallbackMessage?: string): string {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { message?: unknown }).message
		if (typeof message === "string" && message.trim()) {
			return message
		}
	}

	if (fallbackMessage?.trim()) {
		return fallbackMessage
	}

	return "Unexpected sync failure."
}
