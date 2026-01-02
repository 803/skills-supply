import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "./"),
		},
	},
	test: {
		coverage: {
			exclude: ["src/**/*.test.ts"],
			include: ["src/**/*.ts"],
		},
		include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
		name: "sk",
		testTimeout: 30000,
	},
})
