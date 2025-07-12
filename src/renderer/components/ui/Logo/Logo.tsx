import { Box } from '@radix-ui/themes'

interface LogoProps {
  size?: number
  className?: string
  withBackground?: boolean
}

export function Logo({ size = 32, className, withBackground = false }: LogoProps) {
  const iconSize = size * 0.75 // Make the icon slightly smaller than the container

  return (
    <Box
      className={className}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: withBackground ? '20%' : 0,
        backgroundColor: withBackground ? 'var(--accent-3)' : 'transparent',
        padding: withBackground ? size * 0.1 : 0
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="11" cy="4" r="2" fill="var(--accent-9)" />
        <circle cx="18" cy="8" r="2" fill="var(--accent-9)" />
        <circle cx="20" cy="16" r="2" fill="var(--accent-9)" />
        <path
          d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"
          fill="var(--accent-9)"
        />
      </svg>
    </Box>
  )
}
