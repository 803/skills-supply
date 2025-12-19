import type { FC, HTMLAttributes, SVGProps } from "react"

import { cn } from "./utils"

export function FontAwesomeIcon({
	icon,
	alt,
	className,
	...props
}: {
	icon: FC<SVGProps<SVGSVGElement>>
	alt: string
	className?: string
} & HTMLAttributes<SVGSVGElement>) {
	const IconClass = icon

	return (
		<IconClass
			className={cn("size-4", className)}
			role="img"
			aria-label={alt}
			{...props}
		/>
	)
}
