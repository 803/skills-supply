import { withAssetLoaders, withSvgr } from "@skills-supply/shared/next-config-base"
import type { NextConfig } from "next"

const BASE_CONFIG: NextConfig = {
	reactCompiler: true,
}

export default [withSvgr, withAssetLoaders].reduce((acc, fn) => fn(acc), BASE_CONFIG)
