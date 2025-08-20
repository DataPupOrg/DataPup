import { Card, Flex, Text, Button, Box } from '../ui'
import { DropdownMenu, Badge, Spinner } from '@radix-ui/themes'
import { DotsVerticalIcon } from '@radix-ui/react-icons'
import { useState } from 'react'
import './ConnectionCard.css'
import { useContextMenu } from '../../hooks/useContextMenu'
import { ContextMenu, ContextMenuItem } from '../ui/ContextMenu/ContextMenu'

interface ConnectionCardProps {
  connection: {
    id: string
    name: string
    type: string
    host: string
    port: number
    database: string
    username: string
    secure?: boolean
    readonly?: boolean
    lastUsed?: string
    createdAt: string
  }
  onSelect: (connection: ConnectionCardProps['connection']) => void
  onDelete: (connectionId: string) => void
  onTestConnection?: (connection: any) => void
  isLoadingConnection?: boolean
}

export function ConnectionCard({
  connection,
  onSelect,
  onDelete,
  onTestConnection,
  isLoadingConnection
}: ConnectionCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: '50%', y: '50%' })

  const { isOpen, points, contextMenuProps } = useContextMenu()

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setMousePosition({ x: `${x}%`, y: `${y}%` })
  }

  const formatLastUsed = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))

    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`
    const diffInDays = Math.floor(diffInHours / 24)
    return `${diffInDays}d ago`
  }

  const getDatabaseIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'clickhouse':
        return '🔍'
      case 'postgresql':
        return '🐘'
      case 'mysql':
        return '🐬'
      case 'sqlite':
        return '💾'
      default:
        return '🗄️'
    }
  }

  const handleDelete = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setIsDeleting(true)

    // Add a small delay for better UX
    await new Promise((resolve) => setTimeout(resolve, 300))
    onDelete(connection.id)
  }

  return (
    <>
      <Card
        {...contextMenuProps}
        className={`connection-card ${isLoadingConnection ? 'loading' : ''} ${isDeleting ? 'deleting' : ''}`}
        onMouseMove={handleMouseMove}
        onClick={() => !isDeleting && onSelect(connection)}
        style={
          {
            '--mouse-x': mousePosition.x,
            '--mouse-y': mousePosition.y
          } as React.CSSProperties
        }
      >
        <Box className="card-glow" />
        <Flex
          direction="column"
          gap="2"
          className={`card-content ${isLoadingConnection ? 'loading' : ''}`}
        >
          {isLoadingConnection ? (
            <Flex className="card-loading">
              <Spinner className="custom-spinner" />
            </Flex>
          ) : (
            <>
              <Flex justify="between" align="center" gap="2">
                <Flex align="center" gap="2" style={{ flex: 1, minWidth: 0 }}>
                  <Text size="3" className="database-icon">
                    {getDatabaseIcon(connection.type)}
                  </Text>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      size="2"
                      weight="medium"
                      className="connection-name"
                      title={connection.name}
                    >
                      {connection.name}
                    </Text>
                  </Box>
                </Flex>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <Button
                      size="1"
                      variant="ghost"
                      color="gray"
                      className="menu-button"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DotsVerticalIcon />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect({ ...connection, readonly: false })
                      }}
                    >
                      Connect
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect({ ...connection, readonly: true })
                      }}
                    >
                      Connect (Read-only)
                    </DropdownMenu.Item>
                    {onTestConnection && (
                      <DropdownMenu.Item
                        onClick={(e) => {
                          e.stopPropagation()
                          onTestConnection(connection)
                        }}
                      >
                        Test Connection
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item color="red" onClick={handleDelete}>
                      Delete Connection
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Flex>

              <Box className="connection-details">
                <Flex align="center" gap="2">
                  <Text size="1" color="gray">
                    {connection.host}:{connection.port}/{connection.database}
                  </Text>
                  {connection.secure && (
                    <Text size="1" color="green" weight="medium">
                      🔒 Secure
                    </Text>
                  )}
                  {connection.readonly && (
                    <Badge size="1" color="amber" variant="soft">
                      Read-only
                    </Badge>
                  )}
                </Flex>
              </Box>

              <Flex justify="between" align="center" className="card-footer">
                <Text size="1" color="gray">
                  @{connection.username}
                </Text>
                <Text size="1" color="gray">
                  {formatLastUsed(connection.lastUsed || connection.createdAt)}
                </Text>
              </Flex>
            </>
          )}
        </Flex>
      </Card>

      {isOpen && (
        <ContextMenu points={points}>
          <ContextMenuItem onClick={() => onSelect({ ...connection, readonly: false })}>
            Connect
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onSelect({ ...connection, readonly: true })}>
            Connect (Read-only)
          </ContextMenuItem>
          {onTestConnection && (
            <ContextMenuItem onClick={() => onTestConnection(connection)}>
              Test Connection
            </ContextMenuItem>
          )}
          <hr style={{ margin: '4px 0', border: 'none', borderTop: '1px solid #e2e8f0' }} />
          <ContextMenuItem color="red" onClick={() => handleDelete()}>
            Delete Connection
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  )
}
