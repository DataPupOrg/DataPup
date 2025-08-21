import { Card, Flex, Text, Button, Box } from '../ui'
import { DropdownMenu, ContextMenu, Badge, Spinner } from '@radix-ui/themes'
import { DotsVerticalIcon } from '@radix-ui/react-icons'
import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import './ConnectionCard.css'

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
  onSelect: (connection: any) => void
  onDelete: (connectionId: string) => void
  onEdit?: (connection: any) => void
  onTestConnection?: (connection: any) => void
  isLoadingConnection?: boolean
}

export function ConnectionCard({
  connection,
  onSelect,
  onDelete,
  onEdit,
  onTestConnection,
  isLoadingConnection
}: ConnectionCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [mousePosition, setMousePosition] = useState({ x: '50%', y: '50%' })

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

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDeleting(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    onDelete(connection.id)
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <Card
          className={`connection-card ${isLoadingConnection ? 'loading' : ''} ${isHovered ? 'hovered' : ''} ${isDeleting ? 'deleting' : ''}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
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
                        onSelect={() => onSelect({ ...connection, readonly: false })}
                      >
                        Connect
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        onSelect={() => onSelect({ ...connection, readonly: true })}
                      >
                        Connect (Read-only)
                      </DropdownMenu.Item>
                      {onTestConnection && (
                        <DropdownMenu.Item onSelect={() => onTestConnection(connection)}>
                          Test Connection
                        </DropdownMenu.Item>
                      )}
                      {onEdit && (
                        <DropdownMenu.Item onSelect={() => onEdit(connection)}>
                          Edit Connection
                        </DropdownMenu.Item>
                      )}
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        color="red"
                        onSelect={(e) => handleDelete(e as unknown as React.MouseEvent)}
                      >
                        Delete Connection
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Flex>

                <Box className="connection-details">
                  <Flex align="center" gap="2">
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">
                        <strong>host: </strong> {connection.host}
                      </Text>
                      <Text size="1" color="gray">
                        <strong>port: </strong>
                        {connection.port}
                      </Text>
                      <Text size="1" color="gray">
                        <strong>db: </strong>
                        {connection.database}
                      </Text>
                    </Flex>
                  </Flex>
                </Box>

                <Flex justify="between" align="center" className="card-footer">
                  <Text size="1" color="gray">
                    @{connection.username}
                  </Text>
                  {connection.readonly && (
                    <Badge size="1" color="amber" variant="soft">
                      Read-only
                    </Badge>
                  )}
                  {connection.secure && (
                    <Flex align="center" gap="1">
                      <LockKeyhole size={14} color="green" />
                      <Text size="1" color="green" weight="medium">
                        Secure
                      </Text>
                    </Flex>
                  )}
                  <Text size="1" color="gray">
                    {formatLastUsed(connection.lastUsed || connection.createdAt)}
                  </Text>
                </Flex>
              </>
            )}
          </Flex>
        </Card>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item onSelect={() => onSelect({ ...connection, readonly: false })}>
          Connect
        </ContextMenu.Item>
        <ContextMenu.Item onSelect={() => onSelect({ ...connection, readonly: true })}>
          Connect (Read-only)
        </ContextMenu.Item>
        {onTestConnection && (
          <ContextMenu.Item onSelect={() => onTestConnection(connection)}>
            Test Connection
          </ContextMenu.Item>
        )}
        {onEdit && (
          <ContextMenu.Item onSelect={() => onEdit(connection)}>Edit Connection</ContextMenu.Item>
        )}
        <ContextMenu.Separator />
        <ContextMenu.Item
          color="red"
          onSelect={(e) => handleDelete(e as unknown as React.MouseEvent)}
        >
          Delete Connection
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  )
}
