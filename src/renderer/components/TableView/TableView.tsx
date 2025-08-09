import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Button,
  Flex,
  Text,
  Select,
  TextField,
  Table,
  Badge,
  Checkbox,
  DropdownMenu,
  ContextMenu,
  Dialog
} from '@radix-ui/themes'
import {
  PlusCircledIcon,
  TrashIcon,
  DownloadIcon,
  CheckIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  MixerHorizontalIcon
} from '@radix-ui/react-icons'
import { Skeleton, Pagination } from '../ui'
import { TableFilter } from '../../types/tabs'
import { exportToCSV, exportToJSON } from '../../utils/exportData'
import './TableView.css'
import { v4 as uuidv4 } from 'uuid'
import Editor from '@monaco-editor/react'

interface TableViewProps {
  connectionId: string
  database: string
  tableName: string
  onFiltersChange: (filters: TableFilter[]) => void
}

interface Column {
  name: string
  type: string
}

interface QueryResult {
  success: boolean
  data?: any[]
  message: string
  error?: string
  executionTime?: number
}

const OPERATORS = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: '>', label: 'greater than' },
  { value: '<', label: 'less than' },
  { value: '>=', label: 'greater or equal' },
  { value: '<=', label: 'less or equal' },
  { value: 'LIKE', label: 'contains' },
  { value: 'NOT LIKE', label: 'not contains' },
  { value: 'IS NULL', label: 'is null' },
  { value: 'IS NOT NULL', label: 'is not null' }
]

export function TableView({ connectionId, database, tableName, onFiltersChange }: TableViewProps) {
  const [columns, setColumns] = useState<Column[]>([])
  const [filters, setFilters] = useState<TableFilter[]>([])
  const [result, setResult] = useState<QueryResult | null>(null)
  const [changesApplied, setChangesApplied] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSchema, setIsLoadingSchema] = useState(true)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [isReadOnly, setIsReadOnly] = useState(false)
  const [editedCells, setEditedCells] = useState<Map<string, any>>(new Map())
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null)
  const [sortConfig, setSortConfig] = useState<{ column: string; direction: 'asc' | 'desc' }[]>([])
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set())
  const [clonedRows, setClonedRows] = useState<Map<number, any>>(new Map())
  const [supportsTransactions, setSupportsTransactions] = useState(false)
  const [isJsonViewerOpen, setIsJsonViewerOpen] = useState(false)
  const [jsonEditorError, setJsonEditorError] = useState<string | null>(null)
  const [jsonViewerInitialValue, setJsonViewerInitialValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const jsonEditorRef = useRef<any>(null)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [totalRows, setTotalRows] = useState(0)

  // Load table schema on mount
  useEffect(() => {
    loadTableSchema()
  }, [connectionId, database, tableName])

  const getValidFilters = useCallback(() => {
    return filters.filter(
      (f) =>
        f.column &&
        f.operator &&
        (f.value || f.operator === 'IS NULL' || f.operator === 'IS NOT NULL')
    )
  }, [filters])

  const executeQuery = useCallback(async () => {
    if (filters.length === getValidFilters().length && changesApplied) {
      // check if all filters are valid and if changes have been applied
      try {
        setIsLoading(true)
        const startTime = Date.now()
        const validFilters = getValidFilters()
        const sessionId = uuidv4()
        const queryResult = await window.api.database.queryTable(
          connectionId,
          {
            database,
            table: tableName,
            filters: validFilters,
            limit: pageSize,
            offset: (currentPage - 1) * pageSize
          },
          sessionId
        )
        const executionTime = Date.now() - startTime

        setResult({
          ...queryResult,
          executionTime
        })

        // Update total rows for pagination
        if (queryResult.totalRows !== undefined) {
          setTotalRows(queryResult.totalRows)
        }
      } catch (error) {
        console.error('Query execution error:', error)
        setResult({
          success: false,
          message: 'Query execution failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      } finally {
        setIsLoading(false)
      }
    }
  }, [
    filters,
    getValidFilters,
    changesApplied,
    connectionId,
    database,
    tableName,
    pageSize,
    currentPage
  ])

  // Execute query when component mounts, filters change, or pagination changes
  useEffect(() => {
    executeQuery()
  }, [executeQuery])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete selected rows when Delete key is pressed
      if (e.key === 'Delete' && selectedRows.size > 0 && !isReadOnly && !editingCell) {
        e.preventDefault()
        selectedRows.forEach((rowIndex) => markRowForDeletion(rowIndex))
      }

      // Clone selected row when Ctrl/Cmd+D is pressed
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'd' &&
        selectedRows.size === 1 &&
        !isReadOnly &&
        !editingCell
      ) {
        e.preventDefault()
        const selectedRow = Array.from(selectedRows)[0]
        cloneRow(selectedRow)
      }

      // Apply changes when Ctrl/Cmd+S is pressed
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !isReadOnly) {
        e.preventDefault()
        if (editedCells.size > 0 || deletedRows.size > 0 || clonedRows.size > 0) {
          handleApplyChanges()
        }
      }

      // Select all rows when Ctrl/Cmd+A is pressed
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !editingCell) {
        e.preventDefault()
        const allIndices = new Set(result?.data?.map((_, i) => i) || [])
        setSelectedRows(allIndices)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRows, isReadOnly, editingCell, result, editedCells, deletedRows, clonedRows])

  // Check if connection is read-only and supports transactions
  useEffect(() => {
    const checkConnectionCapabilities = async () => {
      try {
        const [readOnlyResponse, transactionSupport] = await Promise.all([
          window.api.database.isReadOnly(connectionId),
          window.api.database.supportsTransactions(connectionId)
        ])
        setIsReadOnly(readOnlyResponse.isReadOnly || false)
        setSupportsTransactions(transactionSupport)
      } catch (error) {
        console.error('Error checking connection capabilities:', error)
        setIsReadOnly(false)
        setSupportsTransactions(false)
      }
    }
    checkConnectionCapabilities()
  }, [connectionId])

  const loadTableSchema = async () => {
    try {
      setIsLoadingSchema(true)
      const schemaResult = await window.api.database.getTableSchema(
        connectionId,
        tableName,
        database
      )
      if (schemaResult.success && schemaResult.schema) {
        const cols: Column[] = schemaResult.schema.map((col: any) => ({
          name: col.name,
          type: col.type
        }))
        setColumns(cols)
      }
    } catch (error) {
      console.error('Error loading table schema:', error)
    } finally {
      setIsLoadingSchema(false)
    }
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setCurrentPage(1) // Reset to first page when page size changes
  }

  const addFilter = () => {
    const newFilter: TableFilter = {
      id: Date.now().toString(),
      column: columns[0]?.name || '',
      operator: '=',
      value: ''
    }
    const newFilters = [...filters, newFilter]
    setFilters(newFilters)
    onFiltersChange(newFilters)
    setCurrentPage(1) // Reset to first page when filters change
  }

  const updateFilter = (id: string, updates: Partial<TableFilter>) => {
    setChangesApplied(false)
    const newFilters = filters.map((f) => (f.id === id ? { ...f, ...updates } : f))
    setFilters(newFilters)
    onFiltersChange(newFilters)
    // Don't reset page on filter value changes, only on apply
  }

  const removeFilter = (id: string) => {
    const newFilters = filters.filter((f) => f.id !== id)
    setFilters(newFilters)
    onFiltersChange(newFilters)
    setCurrentPage(1) // Reset to first page when filters change
  }

  const toggleRowSelection = (index: number, event?: React.MouseEvent) => {
    const newSelected = new Set(selectedRows)

    // If shift key is held, select range
    if (event?.shiftKey && selectedRows.size > 0) {
      const lastSelected = Array.from(selectedRows).pop()!
      const start = Math.min(lastSelected, index)
      const end = Math.max(lastSelected, index)
      for (let i = start; i <= end; i++) {
        newSelected.add(i)
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      // Toggle individual selection
      if (newSelected.has(index)) {
        newSelected.delete(index)
      } else {
        newSelected.add(index)
      }
    } else {
      // Single selection
      newSelected.clear()
      newSelected.add(index)
    }

    setSelectedRows(newSelected)
  }

  const markRowForDeletion = (index: number) => {
    const newDeleted = new Set(deletedRows)
    newDeleted.add(index)
    setDeletedRows(newDeleted)
  }

  const cloneRow = (index: number) => {
    if (!result?.data?.[index]) return

    const originalRow = result.data[index]
    const clonedRow = { ...originalRow }

    // Add the cloned row to the clonedRows map with a new index
    const newIndex = result.data.length + clonedRows.size
    setClonedRows(new Map(clonedRows).set(newIndex, clonedRow))

    // Mark all cells in the cloned row as edited for insert operation
    columns.forEach((col) => {
      const key = `${newIndex}-${col.name}`
      setEditedCells((prev) => new Map(prev).set(key, clonedRow[col.name]))
    })
  }

  const handleCellEdit = (rowIndex: number, column: string, value: any) => {
    const key = `${rowIndex}-${column}`
    const originalValue = result?.data?.[rowIndex]?.[column]

    if (value === originalValue) {
      // Remove from edited cells if value is reverted to original
      const newEdited = new Map(editedCells)
      newEdited.delete(key)
      setEditedCells(newEdited)
    } else {
      setEditedCells(new Map(editedCells).set(key, value))
    }
  }

  const handleStartEdit = (rowIndex: number, column: string) => {
    if (isReadOnly) return
    setEditingCell({ rowIndex, column })
    // Focus input on next render
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleEndEdit = () => {
    setEditingCell(null)
  }

  const handleApplyChanges = async () => {
    if (editedCells.size === 0 && deletedRows.size === 0 && clonedRows.size === 0) return

    try {
      setIsLoading(true)

      // Get primary keys
      const primaryKeys = await window.api.database.getPrimaryKeys(
        connectionId,
        tableName,
        database
      )

      if (primaryKeys.length === 0 && (editedCells.size > 0 || deletedRows.size > 0)) {
        const hasOnlyInserts = Array.from(editedCells.keys()).every((key) => {
          const rowIndex = parseInt(key.split('-')[0])
          return clonedRows.has(rowIndex) || rowIndex === 0
        })

        if (!hasOnlyInserts) {
          alert('Cannot update or delete rows: Table has no primary keys defined')
          return
        }
      }

      // Build bulk operations
      const operations: Array<{
        type: 'insert' | 'update' | 'delete'
        table: string
        data?: Record<string, any>
        primaryKey?: Record<string, any>
        database?: string
      }> = []

      // Add delete operations
      for (const rowIndex of deletedRows) {
        const row = result?.data?.[rowIndex]
        if (row && primaryKeys.length > 0) {
          const primaryKeyValues: Record<string, any> = {}
          primaryKeys.forEach((pk) => {
            primaryKeyValues[pk] = row[pk]
          })
          operations.push({
            type: 'delete',
            table: tableName,
            primaryKey: primaryKeyValues,
            database
          })
        }
      }

      // Group edited cells by row
      const changesByRow = new Map<number, Record<string, any>>()
      editedCells.forEach((value, key) => {
        const [rowIndex, column] = key.split('-')
        const index = parseInt(rowIndex)
        if (!changesByRow.has(index)) {
          changesByRow.set(index, {})
        }
        changesByRow.get(index)![column] = value
      })

      // Add insert and update operations
      for (const [rowIndex, changes] of changesByRow.entries()) {
        // Skip if row is marked for deletion
        if (deletedRows.has(rowIndex)) continue

        const originalRow = result?.data?.[rowIndex] || clonedRows.get(rowIndex)

        // Check if this is a new row (including cloned rows)
        const isNewRow =
          clonedRows.has(rowIndex) ||
          (Object.keys(changes).length === columns.length &&
            columns.every((col) => editedCells.has(`${rowIndex}-${col.name}`)))

        if (isNewRow) {
          operations.push({
            type: 'insert',
            table: tableName,
            data: changes,
            database
          })
        } else if (originalRow && primaryKeys.length > 0) {
          const primaryKeyValues: Record<string, any> = {}
          primaryKeys.forEach((pk) => {
            primaryKeyValues[pk] = originalRow[pk]
          })

          operations.push({
            type: 'update',
            table: tableName,
            primaryKey: primaryKeyValues,
            data: changes,
            database
          })
        }
      }

      // Execute bulk operations
      const bulkResult = await window.api.database.executeBulkOperations(connectionId, operations)

      if (bulkResult.success) {
        // Clear all pending changes after successful update
        setEditedCells(new Map())
        setDeletedRows(new Set())
        setClonedRows(new Map())

        // Add a small delay for ClickHouse to ensure data consistency
        // ClickHouse might have eventual consistency issues where data isn't immediately visible
        await new Promise((resolve) => setTimeout(resolve, 200))

        // Refresh the table data
        await executeQuery()

        if (bulkResult.warning && !supportsTransactions) {
          console.info('Note:', bulkResult.warning)
        }
      } else {
        const failedOps = bulkResult.results.filter((r) => !r.success).length
        alert(`Failed to apply ${failedOps} operation(s): ${bulkResult.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error applying changes:', error)
      alert(
        'Failed to apply changes: ' + (error instanceof Error ? error.message : 'Unknown error')
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (selectedRows.size === 0 || !result?.data) return

    const confirmDelete = window.confirm(
      `Are you sure you want to delete ${selectedRows.size} row(s)?`
    )
    if (!confirmDelete) return

    try {
      setIsLoading(true)

      // Get primary key information for the table
      const schemaResult = await window.api.database.getTableFullSchema(
        connectionId,
        tableName,
        database
      )

      if (!schemaResult.success || !schemaResult.schema) {
        alert('Failed to get table schema for delete operation')
        return
      }

      const primaryKeys = schemaResult.schema.primaryKeys
      if (primaryKeys.length === 0) {
        alert('Cannot delete: Table has no primary keys defined')
        return
      }

      // Delete each selected row
      const deletePromises = Array.from(selectedRows).map(async (rowIndex) => {
        const row = result.data![rowIndex]
        const primaryKeyValues: Record<string, any> = {}

        primaryKeys.forEach((pk) => {
          primaryKeyValues[pk] = row[pk]
        })

        return window.api.database.deleteRow(connectionId, tableName, primaryKeyValues, database)
      })

      const results = await Promise.all(deletePromises)
      const failedDeletes = results.filter((r) => !r.success)

      if (failedDeletes.length > 0) {
        alert(`Failed to delete ${failedDeletes.length} row(s)`)
      } else {
        // Clear selection after successful delete
        setSelectedRows(new Set())
      }

      // Refresh the table data
      await executeQuery()
    } catch (error) {
      console.error('Error deleting rows:', error)
      alert('Failed to delete rows: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddRow = () => {
    if (!result?.data) return

    // Create a new empty row with default values
    const newRow: Record<string, any> = {}
    columns.forEach((col) => {
      newRow[col.name] = col.default || ''
    })

    // Add the new row to the data
    const newData = [newRow, ...result.data]
    setResult({
      ...result,
      data: newData
    })

    // Mark all cells in the new row as edited
    columns.forEach((col) => {
      const key = `0-${col.name}`
      setEditedCells((prev) => new Map(prev).set(key, newRow[col.name]))
    })

    // Optionally, start editing the first cell
    if (columns.length > 0) {
      setTimeout(() => {
        handleStartEdit(0, columns[0].name)
      }, 100)
    }
  }

  const handleSort = (column: string) => {
    const existingSort = sortConfig.find((s) => s.column === column)
    let newSortConfig: typeof sortConfig

    if (!existingSort) {
      newSortConfig = [{ column, direction: 'asc' }]
    } else if (existingSort.direction === 'asc') {
      newSortConfig = [{ column, direction: 'desc' }]
    } else {
      newSortConfig = sortConfig.filter((s) => s.column !== column)
    }

    setSortConfig(newSortConfig)
    // TODO: Apply sorting to query
  }

  const formatResult = (data: any[], result?: QueryResult) => {
    if (!data || data.length === 0) {
      // Check if this is a successful DDL/DML command
      if (result?.isDDL || result?.isDML) {
        return (
          <Flex align="center" justify="center" height="100%" p="4">
            <Text color="green" size="2" weight="medium">
              ✓ {result.message}
            </Text>
          </Flex>
        )
      }
      return <Text color="gray">No data returned</Text>
    }

    const columns = Object.keys(data[0])
    const allData = [...data, ...Array.from(clonedRows.values())]

    const renderCell = (rowIndex: number, column: string, value: any) => {
      const key = `${rowIndex}-${column}`
      const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.column === column
      const isEdited = editedCells.has(key)
      const displayValue = isEdited ? editedCells.get(key) : value

      const isJsonObject =
        typeof displayValue === 'object' && displayValue !== null && !Array.isArray(displayValue)

      if (isEditing) {
        return (
          <TextField.Root
            ref={inputRef}
            size="1"
            value={isJsonObject ? JSON.stringify(displayValue, null, 2) : (displayValue ?? '')}
            onChange={(e) => {
              let newValue: string | object = e.target.value
              try {
                newValue = JSON.parse(e.target.value)
              } catch (error) {
                // Not valid JSON, keep as string.
              }
              handleCellEdit(rowIndex, column, newValue)
            }}
            onBlur={handleEndEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEndEdit()
              if (e.key === 'Escape') {
                handleCellEdit(rowIndex, column, value)
                handleEndEdit()
              }
            }}
            style={{ width: '100%' }}
          />
        )
      }

      // Display mode for both read-only and normal view
      const renderContent = () => {
        if (isJsonObject) {
          const jsonString = JSON.stringify(displayValue)
          return (
            <Text size="1" color="gray" style={{ fontFamily: 'monospace' }}>
              {jsonString.length > 50 ? `${jsonString.substring(0, 50)}...` : jsonString}
            </Text>
          )
        }
        if (displayValue !== null && displayValue !== undefined) {
          return String(displayValue)
        }
        return (
          <Text size="1" color="gray">
            null
          </Text>
        )
      }

      return (
        <Box
          onDoubleClick={() => !isReadOnly && handleStartEdit(rowIndex, column)}
          onClick={() => {
            if (isJsonObject) {
              handleOpenJsonViewer(displayValue)
            }
          }}
          style={{
            cursor: isJsonObject ? 'pointer' : isReadOnly ? 'default' : 'text',
            padding: '2px',
            borderRadius: '2px',
            backgroundColor: isEdited ? 'var(--accent-a5)' : 'transparent',
            width: '100%',
            minHeight: '20px'
          }}
        >
          <Text size="1">{renderContent()}</Text>
        </Box>
      )
    }

    return (
      <Table.Root size="1">
        <Table.Header>
          <Table.Row>
            {!isReadOnly && (
              <Table.ColumnHeaderCell width="50px" style={{ textAlign: 'center' }}>
                <Text size="1" weight="medium">
                  #
                </Text>
              </Table.ColumnHeaderCell>
            )}
            {columns.map((column) => {
              const sortInfo = sortConfig.find((s) => s.column === column)
              return (
                <Table.ColumnHeaderCell
                  key={column}
                  onClick={() => handleSort(column)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <Flex align="center" gap="1">
                    <Text size="1" weight="medium">
                      {column}
                    </Text>
                    {sortInfo &&
                      (sortInfo.direction === 'asc' ? (
                        <ChevronUpIcon width={12} height={12} />
                      ) : (
                        <ChevronDownIcon width={12} height={12} />
                      ))}
                  </Flex>
                </Table.ColumnHeaderCell>
              )
            })}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {allData.map((row, rowIndex) => {
            const isDeleted = deletedRows.has(rowIndex)
            const isCloned = clonedRows.has(rowIndex)
            const isSelected = selectedRows.has(rowIndex)

            // Check if row has any edits
            const hasEdits = Array.from(editedCells.keys()).some((key) => {
              const [editRowIndex] = key.split('-')
              return parseInt(editRowIndex) === rowIndex && !isCloned
            })

            return (
              <ContextMenu.Root key={rowIndex}>
                <ContextMenu.Trigger>
                  <Table.Row
                    style={{
                      opacity: isDeleted ? 0.5 : 1,
                      backgroundColor: isDeleted
                        ? 'var(--red-a4)'
                        : hasEdits
                          ? 'var(--accent-a3)'
                          : isSelected
                            ? 'var(--accent-a2)'
                            : 'transparent',
                      cursor: 'pointer'
                    }}
                  >
                    {!isReadOnly && (
                      <Table.Cell
                        onClick={(e) => toggleRowSelection(rowIndex, e)}
                        style={{
                          textAlign: 'center',
                          cursor: 'pointer',
                          userSelect: 'none',
                          fontWeight: isSelected ? 'bold' : 'normal'
                        }}
                      >
                        <Text size="1" color={isDeleted ? 'red' : isCloned ? 'green' : undefined}>
                          {rowIndex + 1}
                        </Text>
                      </Table.Cell>
                    )}
                    {columns.map((column) => (
                      <Table.Cell key={column}>
                        {renderCell(rowIndex, column, row[column])}
                      </Table.Cell>
                    ))}
                  </Table.Row>
                </ContextMenu.Trigger>
                <ContextMenu.Content size="1" style={{ minWidth: '120px' }}>
                  <ContextMenu.Item onClick={() => cloneRow(rowIndex)} disabled={isDeleted}>
                    Clone Row
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onClick={() => markRowForDeletion(rowIndex)}
                    disabled={isDeleted || isCloned}
                    color="red"
                  >
                    Delete Row
                  </ContextMenu.Item>
                  <ContextMenu.Separator />
                  <ContextMenu.Item onClick={() => handleStartEdit(rowIndex, columns[0])}>
                    Edit Row
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Root>
            )
          })}
        </Table.Body>
      </Table.Root>
    )
  }

  const handleOpenJsonViewer = (value: any) => {
    setJsonViewerInitialValue(JSON.stringify(value, null, 2))
    setJsonEditorError(null)
    setIsJsonViewerOpen(true)
  }

  return (
    <Box className="table-view">
      <Flex direction="column" height="100%">
        {/* Filters Section */}
        <Box className="filters-section">
          <Flex justify="between" align="center" p="1" className="filter-header">
            <Text size="1" weight="medium">
              Filters
            </Text>
            <Flex gap="1">
              <Button
                size="1"
                variant="outline"
                onClick={addFilter}
                disabled={isLoadingSchema}
                title="Add filter"
              >
                <MixerHorizontalIcon />
                Filter
              </Button>
              <Button
                size="1"
                onClick={async () => {
                  setCurrentPage(1)
                  await executeQuery()
                  setChangesApplied(true)
                }}
                disabled={isLoading}
                title="Apply filters"
              >
                <CheckIcon />
              </Button>
            </Flex>
          </Flex>
          <Box px="1" py="1">
            {filters.map((filter, index) => (
              <Flex
                key={filter.id}
                gap="1"
                align="center"
                mb={index < filters.length - 1 ? '1' : '0'}
              >
                <Select.Root
                  value={filter.column}
                  onValueChange={(value) => updateFilter(filter.id, { column: value })}
                  disabled={isLoadingSchema}
                >
                  <Select.Trigger placeholder="Select column" className="filter-select" size="1" />
                  <Select.Content>
                    {columns.map((col) => (
                      <Select.Item key={col.name} value={col.name}>
                        <Text size="1">{col.name}</Text>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>

                <Select.Root
                  value={filter.operator}
                  onValueChange={(value) => updateFilter(filter.id, { operator: value as any })}
                >
                  <Select.Trigger className="filter-select" size="1" />
                  <Select.Content>
                    {OPERATORS.map((op) => (
                      <Select.Item key={op.value} value={op.value}>
                        <Text size="1">{op.label}</Text>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>

                {filter.operator !== 'IS NULL' && filter.operator !== 'IS NOT NULL' && (
                  <TextField.Root
                    value={filter.value}
                    onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                    placeholder="Value"
                    className="filter-input"
                    size="1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        executeQuery()
                      }
                    }}
                  />
                )}

                <Button
                  size="1"
                  variant="ghost"
                  color="red"
                  onClick={() => removeFilter(filter.id)}
                  style={{ padding: '0 4px', minWidth: '20px', height: '20px' }}
                >
                  ×
                </Button>
              </Flex>
            ))}
          </Box>
        </Box>

        {/* Results Section */}
        <Box className="results-section">
          <Flex justify="between" align="center" p="2" className="results-header">
            <Flex align="center" gap="3">
              <Text size="2" weight="medium">
                Results
              </Text>
              {result?.success && result.data && (
                <>
                  <Badge size="1" variant="soft">
                    {totalRows > pageSize
                      ? `Page ${currentPage} (${result.data.length} rows)`
                      : `${result.data.length} rows`}
                  </Badge>
                  {result.executionTime && (
                    <Badge size="1" variant="soft" color="gray">
                      {result.executionTime}ms
                    </Badge>
                  )}
                  {selectedRows.size > 0 && (
                    <Badge size="1" variant="soft" color="blue">
                      {selectedRows.size} selected
                    </Badge>
                  )}
                  {deletedRows.size > 0 && (
                    <Badge size="1" variant="soft" color="red">
                      {deletedRows.size} to delete
                    </Badge>
                  )}
                  {clonedRows.size > 0 && (
                    <Badge size="1" variant="soft" color="green">
                      {clonedRows.size} to insert
                    </Badge>
                  )}
                  {(() => {
                    // Count edited rows (excluding cloned rows which are inserts)
                    const editedRowsSet = new Set<number>()
                    editedCells.forEach((_, key) => {
                      const rowIndex = parseInt(key.split('-')[0])
                      if (!clonedRows.has(rowIndex)) {
                        editedRowsSet.add(rowIndex)
                      }
                    })
                    return editedRowsSet.size > 0 ? (
                      <Badge size="1" variant="soft" color="blue">
                        {editedRowsSet.size} to update
                      </Badge>
                    ) : null
                  })()}
                </>
              )}
            </Flex>

            <Flex gap="1" align="center">
              {!isReadOnly && result?.success && result.data && (
                <>
                  <Button
                    size="1"
                    variant="soft"
                    onClick={handleAddRow}
                    disabled={isLoading}
                    title="Add new row"
                    style={{ cursor: 'pointer' }}
                  >
                    <PlusCircledIcon />
                  </Button>
                  {(editedCells.size > 0 || deletedRows.size > 0 || clonedRows.size > 0) && (
                    <Button
                      size="1"
                      variant="solid"
                      onClick={handleApplyChanges}
                      disabled={isLoading}
                      title="Apply all pending changes"
                    >
                      <CheckIcon />
                      Apply Changes (
                      {(() => {
                        const editedRowsSet = new Set<number>()
                        editedCells.forEach((_, key) => {
                          const rowIndex = parseInt(key.split('-')[0])
                          if (!clonedRows.has(rowIndex)) {
                            editedRowsSet.add(rowIndex)
                          }
                        })
                        return editedRowsSet.size + deletedRows.size + clonedRows.size
                      })()}
                      )
                    </Button>
                  )}
                </>
              )}
              {result?.success && result.data && result.data.length > 0 && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <Button
                      size="1"
                      variant="soft"
                      title="Export data"
                      style={{ cursor: 'pointer' }}
                    >
                      <DownloadIcon />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Label>Current Page</DropdownMenu.Label>
                    <DropdownMenu.Item
                      onClick={() =>
                        exportToCSV(result.data || [], `${tableName}-page${currentPage}-export.csv`)
                      }
                    >
                      Export as CSV
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onClick={() =>
                        exportToJSON(
                          result.data || [],
                          `${tableName}-page${currentPage}-export.json`
                        )
                      }
                    >
                      Export as JSON
                    </DropdownMenu.Item>
                    {totalRows > pageSize && (
                      <>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Label>
                          All Data ({totalRows.toLocaleString()} rows)
                        </DropdownMenu.Label>
                        <DropdownMenu.Item
                          onClick={async () => {
                            // TODO: Implement streaming export for large datasets
                            alert('Export all data feature coming soon!')
                          }}
                        >
                          Export all as CSV
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onClick={async () => {
                            // TODO: Implement streaming export for large datasets
                            alert('Export all data feature coming soon!')
                          }}
                        >
                          Export all as JSON
                        </DropdownMenu.Item>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              )}
            </Flex>
          </Flex>

          <Box className="results-content">
            {isLoading ? (
              <Flex direction="column" gap="2" p="4">
                <Skeleton height={32} />
                <Skeleton height={32} />
                <Skeleton height={32} />
              </Flex>
            ) : result ? (
              result.success ? (
                <Box className="result-table-container">
                  {formatResult(result.data || [], result)}
                </Box>
              ) : (
                <Flex align="center" justify="center" height="100%" p="4">
                  <Box className="error-message">
                    <Text size="2" color="red" weight="medium">
                      {result.message}
                    </Text>
                    {result.error && (
                      <Text size="1" color="red" mt="1" style={{ display: 'block' }}>
                        {result.error}
                      </Text>
                    )}
                  </Box>
                </Flex>
              )
            ) : (
              <Flex align="center" justify="center" height="100%">
                <Text color="gray" size="1">
                  Loading table data...
                </Text>
              </Flex>
            )}
          </Box>

          {/* Pagination */}
          {result?.success && totalRows > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(totalRows / pageSize)}
              totalRows={totalRows}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              isLoading={isLoading}
            />
          )}
        </Box>
      </Flex>
      <Dialog.Root open={isJsonViewerOpen} onOpenChange={setIsJsonViewerOpen}>
        <Dialog.Content style={{ maxWidth: 600 }}>
          <Dialog.Title>
            <Text size="1">JSON</Text>
          </Dialog.Title>
          <Box
            mt="3"
            style={{
              maxHeight: '50vh',
              overflow: 'auto',
              background: 'var(--gray-2)',
              borderRadius: 'var(--radius-2)',
              padding: 'var(--space-2)'
            }}
          >
            <Editor
              key={jsonViewerInitialValue}
              height="400px"
              defaultLanguage="json"
              defaultValue={jsonViewerInitialValue}
              onMount={(editor) => {
                jsonEditorRef.current = editor
              }}
              options={{
                readOnly: isReadOnly,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                formatOnPaste: true,
                formatOnType: true,
                automaticLayout: true,
                padding: { top: 8, bottom: 8 },
                renderLineHighlight: 'none',
                renderLineHighlightOnlyWhenFocus: false
              }}
              theme={document.body.classList.contains('dark') ? 'vs-dark' : 'vs'}
            />
            {jsonEditorError && (
              <Text color="red" mt="2" size="1">
                {jsonEditorError}
              </Text>
            )}
          </Box>
          <Flex gap="2" mt="3" justify="end">
            {!isReadOnly && (
              <Button
                size="1"
                variant="solid"
                onClick={() => {
                  if (!jsonEditorRef.current) return
                  try {
                    const editorValue = jsonEditorRef.current.getValue()
                    JSON.parse(editorValue)
                    setJsonEditorError(null)
                    // FIXME: save the updates to DB
                    setIsJsonViewerOpen(false)
                  } catch (e: any) {
                    setJsonEditorError('Invalid JSON: ' + e.message)
                  }
                }}
              >
                Save
              </Button>
            )}
            <Dialog.Close>
              <Button size="1" variant="soft">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  )
}
