import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
	test: {
		coverage: {
			exclude: ["src/**/*.test.ts"],
			include: ["src/**/*.ts"],
		},
		exclude: ["tests/e2e/**/*.test.ts"],
		include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
	},
})
