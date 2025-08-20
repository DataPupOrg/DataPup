import { useState, useEffect } from 'react'
import { Box, Flex, ScrollArea, Text, Button } from '@radix-ui/themes'
import { Badge, Skeleton } from '../ui'
import './DatabaseExplorer.css'
import { ReloadIcon, ChevronRightIcon, ChevronDownIcon, TableIcon } from '@radix-ui/react-icons'

interface DatabaseExplorerProps {
  connectionId: string
  connectionName: string
  onTableDoubleClick?: (database: string, tableName: string) => void
}

interface DatabaseObject {
  name: string
  type: 'table' | 'view' | 'function' | 'procedure' | 'trigger'
  schema?: string
  columns?: Column[]
  indexes?: Index[]
  expanded?: boolean
  loading?: boolean
}

interface Column {
  name: string
  type: string
  nullable?: boolean
  default?: string
  primary?: boolean
}

interface Index {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
}

interface Database {
  name: string
  expanded: boolean
  objects?: DatabaseObject[]
  loading?: boolean
}

const getObjectIcon = (type: DatabaseObject['type']) => {
  switch (type) {
    case 'table':
      return <TableIcon />
    case 'view':
      return '👁️'
    case 'function':
      return '⚡'
    case 'procedure':
      return '📝'
    case 'trigger':
      return '🔔'
    default:
      return '📄'
  }
}

const getObjectColor = (type: DatabaseObject['type']) => {
  switch (type) {
    case 'table':
      return 'blue'
    case 'view':
      return 'green'
    case 'function':
      return 'orange'
    case 'procedure':
      return 'purple'
    case 'trigger':
      return 'red'
    default:
      return 'gray'
  }
}

export function DatabaseExplorer({
  connectionId,
  connectionName,
  onTableDoubleClick
}: DatabaseExplorerProps) {
  const [databases, setDatabases] = useState<Database[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    loadDatabases()
  }, [connectionId])

  const loadDatabases = async () => {
    try {
      setLoading(true)
      const result = await window.api.database.getDatabases(connectionId)
      if (result.success && result.databases) {
        setDatabases(
          result.databases.map((name: string) => ({
            name,
            expanded: false,
            objects: undefined
          }))
        )
      }
    } catch (error) {
      console.error('Error loading databases:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleDatabase = async (dbName: string) => {
    const db = databases.find((d) => d.name === dbName)
    if (!db) return

    if (!db.expanded && !db.objects) {
      // Load database objects
      setDatabases((prev) => prev.map((d) => (d.name === dbName ? { ...d, loading: true } : d)))

      try {
        const result = await window.api.database.getTables(connectionId, dbName)
        if (result.success && result.tables) {
          const objects: DatabaseObject[] = result.tables.map((tableName: string) => ({
            name: tableName,
            type: 'table' as const,
            expanded: false
          }))

          setDatabases((prev) =>
            prev.map((d) =>
              d.name === dbName ? { ...d, expanded: true, objects, loading: false } : d
            )
          )
        } else {
          console.error('Failed to load tables:', result.message)
          setDatabases((prev) =>
            prev.map((d) => (d.name === dbName ? { ...d, loading: false } : d))
          )
        }
      } catch (error) {
        console.error('Error loading tables:', error)
        setDatabases((prev) => prev.map((d) => (d.name === dbName ? { ...d, loading: false } : d)))
      }
    } else {
      setDatabases((prev) =>
        prev.map((d) => (d.name === dbName ? { ...d, expanded: !d.expanded } : d))
      )
    }
  }

  const toggleTable = async (dbName: string, tableName: string) => {
    const db = databases.find((d) => d.name === dbName)
    if (!db || !db.objects) return

    const tableIndex = db.objects.findIndex((obj) => obj.name === tableName)
    if (tableIndex === -1) return

    const table = db.objects[tableIndex]

    if (!table.expanded && !table.columns) {
      // Load table schema
      setDatabases((prev) =>
        prev.map((d) => {
          if (d.name === dbName) {
            const newObjects = [...d.objects!]
            newObjects[tableIndex] = { ...table, loading: true }
            return { ...d, objects: newObjects }
          }
          return d
        })
      )

      try {
        const result = await window.api.database.getTableSchema(connectionId, tableName, dbName)
        if (result.success && result.schema) {
          const columns: Column[] = result.schema.map((col: any) => ({
            name: col.name,
            type: col.type,
            nullable: col.nullable,
            default: col.default_expression || col.default,
            primary: col.is_primary_key || false
          }))

          setDatabases((prev) =>
            prev.map((d) => {
              if (d.name === dbName) {
                const newObjects = [...d.objects!]
                newObjects[tableIndex] = { ...table, columns, expanded: true, loading: false }
                return { ...d, objects: newObjects }
              }
              return d
            })
          )
        } else {
          console.error('Failed to load table schema:', result.message)
          setDatabases((prev) =>
            prev.map((d) => {
              if (d.name === dbName) {
                const newObjects = [...d.objects!]
                newObjects[tableIndex] = { ...table, loading: false }
                return { ...d, objects: newObjects }
              }
              return d
            })
          )
        }
      } catch (error) {
        console.error('Error loading table schema:', error)
        setDatabases((prev) =>
          prev.map((d) => {
            if (d.name === dbName) {
              const newObjects = [...d.objects!]
              newObjects[tableIndex] = { ...table, loading: false }
              return { ...d, objects: newObjects }
            }
            return d
          })
        )
      }
    } else {
      // Toggle expanded state
      setDatabases((prev) =>
        prev.map((d) => {
          if (d.name === dbName) {
            const newObjects = [...d.objects!]
            newObjects[tableIndex] = { ...table, expanded: !table.expanded }
            return { ...d, objects: newObjects }
          }
          return d
        })
      )
    }
  }

  const filteredDatabases = databases.filter(
    (db) =>
      db.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      db.objects?.some((obj) => obj.name.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  return (
    <Flex direction="column" className="database-explorer">
      <Box className="explorer-header" p="2">
        <input
          type="text"
          placeholder="Search objects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="explorer-search"
        />
      </Box>

      <ScrollArea className="explorer-content">
        {loading ? (
          <Flex direction="column" gap="2" p="3">
            <Skeleton height={32} />
            <Skeleton height={32} />
            <Skeleton height={32} />
          </Flex>
        ) : filteredDatabases.length > 0 ? (
          <Box className="database-list">
            {filteredDatabases.map((db) => (
              <Box key={db.name} className="database-group">
                <Flex
                  align="center"
                  gap="2"
                  className={`database-item ${db.expanded ? 'expanded' : ''}`}
                  p="2"
                >
                  <Box
                    className="expand-icon"
                    onClick={() => toggleDatabase(db.name)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  >
                    {db.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  </Box>
                  <Flex align="center" justify="between" style={{ flex: 1 }}>
                    <Text
                      size="1"
                      style={{ fontWeight: 500, flex: 1 }}
                      onClick={() => toggleDatabase(db.name)}
                    >
                      {db.name}
                    </Text>
                    <Button
                      size="1"
                      variant="ghost"
                      className="database-reload-button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        // Refresh tables for this database
                        const result = await window.api.database.getTables(connectionId, db.name)
                        if (result.success && result.tables) {
                          const objects = result.tables.map((tableName: string) => ({
                            name: tableName,
                            type: 'table' as const,
                            expanded: false
                          }))
                          setDatabases((prev) =>
                            prev.map((d) =>
                              d.name === db.name
                                ? { ...d, objects, expanded: true, loading: false }
                                : d
                            )
                          )
                        }
                      }}
                      aria-label={`Refresh ${db.name}`}
                      style={{
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        transform: 'scale(0.8)',
                        cursor: 'pointer'
                      }}
                    >
                      <ReloadIcon />
                    </Button>
                  </Flex>
                </Flex>

                {db.loading && (
                  <Box p="3" pl="6">
                    <Flex direction="column" gap="2">
                      <Skeleton height={24} width="80%" />
                      <Skeleton height={24} width="70%" />
                      <Skeleton height={24} width="85%" />
                    </Flex>
                  </Box>
                )}

                {db.expanded && db.objects && (
                  <Box className="object-list" pl="4">
                    {db.objects.map((obj) => (
                      <Box key={`${db.name}.${obj.name}`}>
                        <Flex
                          align="center"
                          gap="2"
                          className={`object-item ${obj.expanded ? 'expanded' : ''}`}
                          p="1"
                          onDoubleClick={() => {
                            if (obj.type === 'table' && onTableDoubleClick) {
                              onTableDoubleClick(db.name, obj.name)
                            }
                          }}
                          style={{ cursor: obj.type === 'table' ? 'pointer' : 'default' }}
                        >
                          {obj.type === 'table' && (
                            <Box
                              className="expand-icon"
                              onClick={() => toggleTable(db.name, obj.name)}
                              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            >
                              {obj.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                            </Box>
                          )}
                          <Box style={{ display: 'flex', alignItems: 'center' }}>
                            {getObjectIcon(obj.type)}
                          </Box>
                          <Text size="1" className="object-name">
                            {obj.name}
                          </Text>
                          {obj.type !== 'table' && (
                            <Badge size="1" color={getObjectColor(obj.type) as any}>
                              {obj.type}
                            </Badge>
                          )}
                        </Flex>

                        {obj.loading && (
                          <Box pl="6" py="1">
                            <Flex direction="column" gap="1">
                              <Skeleton height={20} width="60%" />
                              <Skeleton height={20} width="80%" />
                            </Flex>
                          </Box>
                        )}

                        {obj.expanded && obj.columns && (
                          <Box className="column-list" pl="6">
                            {obj.columns.map((col) => (
                              <Flex
                                key={`${db.name}.${obj.name}.${col.name}`}
                                align="center"
                                gap="2"
                                className="column-item"
                                p="1"
                              >
                                <Text size="1">◦</Text>
                                <Text size="1" className="column-name">
                                  {col.name}
                                </Text>
                                <Text size="1" color="gray">
                                  {col.type}
                                </Text>
                                {col.primary && (
                                  <Badge size="1" color="amber">
                                    PK
                                  </Badge>
                                )}
                                {col.nullable === false && (
                                  <Badge size="1" color="red">
                                    NOT NULL
                                  </Badge>
                                )}
                              </Flex>
                            ))}
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        ) : (
          <Box p="3">
            <Text size="2" color="gray">
              {searchQuery ? 'No matching objects found' : 'No databases found'}
            </Text>
          </Box>
        )}
      </ScrollArea>
    </Flex>
  )
}
