import { useState, useEffect, useCallback } from 'react'

export const useContextMenu = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [points, setPoints] = useState({ x: 0, y: 0 })

  // This effect is used to close the context menu when the user clicks outside of it.
  useEffect(() => {
    const handleClick = () => setIsOpen(false)
    if (isOpen) {
      document.addEventListener('click', handleClick)
    }
    return () => {
      document.removeEventListener('click', handleClick)
    }
  }, [isOpen])

  // Function to open the context menu at the mouse position
  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsOpen(true)
    setPoints({ x: e.pageX, y: e.pageY })
  }, [])

  const contextMenuProps = {
    onContextMenu: open
  }

  return {
    isOpen,
    points,
    contextMenuProps
  }
}
