import React from 'react'
import { Box, Button, Flex, Text, Select } from '@radix-ui/themes'
import { PaginationInfo } from '../../types/tabs'

interface PaginationProps {
  pagination: PaginationInfo
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  disabled?: boolean
}

export function Pagination({
  pagination,
  onPageChange,
  onPageSizeChange,
  disabled = false
}: PaginationProps) {
  const { currentPage, pageSize, totalCount, totalPages, hasMore, hasPrevious } = pagination

  const handlePreviousPage = () => {
    if (hasPrevious && !disabled) {
      onPageChange(currentPage - 1)
    }
  }

  const handleNextPage = () => {
    if (hasMore && !disabled) {
      onPageChange(currentPage + 1)
    }
  }

  const handleFirstPage = () => {
    if (currentPage > 1 && !disabled) {
      onPageChange(1)
    }
  }

  const handleLastPage = () => {
    if (totalPages && currentPage < totalPages && !disabled) {
      onPageChange(totalPages)
    }
  }

  const handlePageSizeChange = (newPageSize: string) => {
    if (!disabled) {
      onPageSizeChange(parseInt(newPageSize))
    }
  }

  // Calculate the range of items being shown
  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalCount || currentPage * pageSize)

  return (
    <Box className="pagination-container">
      <Flex justify="between" align="center" gap="3" p="2">
        {/* Page info */}
        <Flex align="center" gap="2">
          <Text size="1" color="gray">
            {totalCount !== undefined
              ? `Showing ${startItem}-${endItem} of ${totalCount} records`
              : `Showing ${pageSize} records per page`}
          </Text>
        </Flex>

        {/* Pagination controls */}
        <Flex align="center" gap="2">
          {/* Page size selector */}
          <Flex align="center" gap="1">
            <Text size="1" color="gray">
              Rows:
            </Text>
            <Select.Root
              value={pageSize.toString()}
              onValueChange={handlePageSizeChange}
              disabled={disabled}
            >
              <Select.Trigger size="1" style={{ minWidth: '60px' }} />
              <Select.Content>
                <Select.Item value="25">25</Select.Item>
                <Select.Item value="50">50</Select.Item>
                <Select.Item value="100">100</Select.Item>
                <Select.Item value="200">200</Select.Item>
                <Select.Item value="500">500</Select.Item>
              </Select.Content>
            </Select.Root>
          </Flex>

          {/* Page navigation */}
          <Flex align="center" gap="1">
            <Button
              size="1"
              variant="ghost"
              onClick={handleFirstPage}
              disabled={!hasPrevious || disabled}
              title="First page"
            >
              ⟪
            </Button>
            <Button
              size="1"
              variant="ghost"
              onClick={handlePreviousPage}
              disabled={!hasPrevious || disabled}
              title="Previous page"
            >
              ⟨
            </Button>

            <Text size="1" color="gray" style={{ minWidth: '80px', textAlign: 'center' }}>
              Page {currentPage}
              {totalPages ? ` of ${totalPages}` : ''}
            </Text>

            <Button
              size="1"
              variant="ghost"
              onClick={handleNextPage}
              disabled={!hasMore || disabled}
              title="Next page"
            >
              ⟩
            </Button>
            <Button
              size="1"
              variant="ghost"
              onClick={handleLastPage}
              disabled={!totalPages || currentPage >= totalPages || disabled}
              title="Last page"
            >
              ⟫
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  )
}
