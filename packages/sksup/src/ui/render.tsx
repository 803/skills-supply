import { render } from "ink"
import type { ReactElement } from "react"

export async function runInkApp(element: ReactElement): Promise<void> {
	const instance = render(element)
	await instance.waitUntilExit()
}
