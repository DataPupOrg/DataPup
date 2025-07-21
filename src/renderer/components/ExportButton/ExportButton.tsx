import React, { useState } from 'react'
import { Button, DropdownMenu, Flex, Text } from '@radix-ui/themes'
import { exportToCSV, exportToJSON, exportToSQL } from '../../utils/exportData'
import { PaginationInfo } from '../../types/tabs'

interface ExportButtonProps {
  currentData: any[]
  pagination?: PaginationInfo
  onExportAll?: (format: 'csv' | 'json' | 'sql') => Promise<any[]>
  disabled?: boolean
}

export function ExportButton({
  currentData,
  pagination,
  onExportAll,
  disabled = false
}: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async (format: 'csv' | 'json' | 'sql', exportAll = false) => {
    if (disabled || isExporting) return

    try {
      setIsExporting(true)

      let dataToExport = currentData
      let filename = 'query-results'

      if (
        exportAll &&
        onExportAll &&
        pagination?.totalCount &&
        pagination.totalCount > currentData.length
      ) {
        // Export all data
        dataToExport = await onExportAll(format)
        filename = `query-results-all-${pagination.totalCount}-records`
      } else {
        // Export current page
        if (pagination) {
          filename = `query-results-page-${pagination.currentPage}-of-${pagination.totalPages || 'unknown'}`
        }
      }

      switch (format) {
        case 'csv':
          exportToCSV(dataToExport, `${filename}.csv`)
          break
        case 'json':
          exportToJSON(dataToExport, `${filename}.json`)
          break
        case 'sql':
          exportToSQL(dataToExport, 'exported_data', `${filename}.sql`)
          break
      }
    } catch (error) {
      console.error('Export failed:', error)
      // You could add a toast notification here
    } finally {
      setIsExporting(false)
    }
  }

  const hasMultiplePages = pagination && pagination.totalPages && pagination.totalPages > 1
  const canExportAll = hasMultiplePages && onExportAll

  if (!hasMultiplePages) {
    // Simple export buttons when no pagination
    return (
      <Flex gap="1">
        <Button
          size="1"
          variant="ghost"
          onClick={() => handleExport('csv')}
          disabled={disabled || isExporting}
        >
          CSV
        </Button>
        <Button
          size="1"
          variant="ghost"
          onClick={() => handleExport('json')}
          disabled={disabled || isExporting}
        >
          JSON
        </Button>
      </Flex>
    )
  }

  // Enhanced export with pagination options
  return (
    <Flex gap="1">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button size="1" variant="ghost" disabled={disabled || isExporting}>
            {isExporting ? 'Exporting...' : 'CSV'} ↓
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={() => handleExport('csv', false)}>
            <Flex direction="column" align="start">
              <Text size="1" weight="medium">
                Current Page
              </Text>
              <Text size="1" color="gray">
                {currentData.length} records (Page {pagination?.currentPage})
              </Text>
            </Flex>
          </DropdownMenu.Item>
          {canExportAll && (
            <DropdownMenu.Item onClick={() => handleExport('csv', true)}>
              <Flex direction="column" align="start">
                <Text size="1" weight="medium">
                  All Data
                </Text>
                <Text size="1" color="gray">
                  {pagination?.totalCount} records (All pages)
                </Text>
              </Flex>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button size="1" variant="ghost" disabled={disabled || isExporting}>
            {isExporting ? 'Exporting...' : 'JSON'} ↓
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={() => handleExport('json', false)}>
            <Flex direction="column" align="start">
              <Text size="1" weight="medium">
                Current Page
              </Text>
              <Text size="1" color="gray">
                {currentData.length} records (Page {pagination?.currentPage})
              </Text>
            </Flex>
          </DropdownMenu.Item>
          {canExportAll && (
            <DropdownMenu.Item onClick={() => handleExport('json', true)}>
              <Flex direction="column" align="start">
                <Text size="1" weight="medium">
                  All Data
                </Text>
                <Text size="1" color="gray">
                  {pagination?.totalCount} records (All pages)
                </Text>
              </Flex>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Flex>
  )
}
