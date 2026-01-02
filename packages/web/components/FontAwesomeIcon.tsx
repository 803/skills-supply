import { type ClassValue, clsx } from "clsx"
import type { FC, HTMLAttributes, SVGProps } from "react"
import { twMerge } from "tailwind-merge"

function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

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
