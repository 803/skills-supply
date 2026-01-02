import { consola } from "consola"

// CommandResult models user-facing flow outcomes; core operations keep { ok, value } results.
export type CommandResult<T = void> =
	| { status: "completed"; value: T }
	| { status: "unchanged"; reason: string }
	| { status: "cancelled" }
	| { status: "failed" }

export const CommandResult = {
	cancelled: (): CommandResult<never> => ({ status: "cancelled" }),
	completed: <T>(value: T): CommandResult<T> => ({ status: "completed", value }),
	failed: (): CommandResult<never> => ({ status: "failed" }),
	unchanged: (reason: string): CommandResult<never> => ({
		reason,
		status: "unchanged",
	}),
} as const

export function printOutcome(result: CommandResult<unknown>): void {
	switch (result.status) {
		case "completed":
			consola.success("Done.")
			break
		case "unchanged":
			consola.info(result.reason)
			break
		case "cancelled":
			consola.info("Canceled.")
			break
		case "failed":
			process.exitCode = 1
			break
	}
}
