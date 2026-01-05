import type { Result } from "@skills-supply/core"
import type { IoError } from "@/types/errors"

export type { IoError } from "@/types/errors"

export type IoResult<T> = Result<T, IoError>
