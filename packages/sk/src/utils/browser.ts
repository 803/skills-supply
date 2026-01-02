import open from "open"

export async function openBrowser(url: string): Promise<boolean> {
	try {
		await open(url)
		return true
	} catch {
		return false
	}
}
