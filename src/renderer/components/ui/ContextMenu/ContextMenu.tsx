import './ContextMenu.css'

interface ContextMenuProps {
  points: {
    x: number
    y: number
  }
  children: React.ReactNode
}

export function ContextMenu({ points, children }: ContextMenuProps) {
  return (
    <div
      className="context-menu"
      style={{
        top: `${points.y}px`,
        left: `${points.x}px`
      }}
    >
      {children}
    </div>
  )
}

// You can create a simple, reusable item component as well
export function ContextMenuItem({
  children,
  onClick,
  color
}: {
  children: React.ReactNode
  onClick?: () => void
  color?: 'red'
}) {
  const className = color === 'red' ? 'context-menu-item red' : 'context-menu-item'
  return (
    <div className={className} onClick={onClick}>
      {children}
    </div>
  )
}
