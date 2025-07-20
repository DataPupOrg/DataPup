import { useQuery, useInfiniteQuery } from '@tanstack/react-query'

export interface QueryOptions {
  page?: number
  limit?: number
}

export interface QueryPage {
  data: any[]
  pagination?: {
    currentPage: number
    pageSize: number
    totalCount?: number
    totalPages?: number
    hasMore: boolean
    hasPrevious: boolean
  }
  success: boolean
  message: string
  error?: string
  executionTime?: number
}

// Query key factory for consistent caching
export const queryKeys = {
  all: ['queries'] as const,
  connection: (connectionId: string) => [...queryKeys.all, 'connection', connectionId] as const,
  query: (connectionId: string, sql: string) =>
    [...queryKeys.connection(connectionId), sql] as const
}

// Hook for executing a single page query
export function useDatabaseQuery(
  connectionId: string,
  sql: string,
  options?: QueryOptions,
  enabled = true
) {
  return useQuery({
    queryKey: [...queryKeys.query(connectionId, sql), options],
    queryFn: async (): Promise<QueryPage> => {
      const startTime = Date.now()
      const result = await window.api.database.query(
        connectionId,
        sql.trim(),
        undefined, // sessionId
        options
      )
      const executionTime = Date.now() - startTime

      return {
        ...result,
        executionTime
      }
    },
    enabled: enabled && !!connectionId && !!sql.trim(),
    staleTime: 0, // Always consider query results stale for real-time data
    gcTime: 5 * 60 * 1000 // Keep in cache for 5 minutes
  })
}

// Hook for infinite loading queries with automatic pagination
export function useInfiniteDatabaseQuery(connectionId: string, sql: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.query(connectionId, sql),
    queryFn: async ({ pageParam = 1 }): Promise<QueryPage> => {
      const startTime = Date.now()
      const result = await window.api.database.query(
        connectionId,
        sql.trim(),
        undefined, // sessionId
        { page: pageParam, limit: 100 }
      )
      const executionTime = Date.now() - startTime

      return {
        ...result,
        executionTime
      }
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.pagination || !lastPage.pagination.hasMore) {
        return undefined
      }
      return lastPage.pagination.currentPage + 1
    },
    getPreviousPageParam: (firstPage) => {
      if (!firstPage.pagination || !firstPage.pagination.hasPrevious) {
        return undefined
      }
      return firstPage.pagination.currentPage - 1
    },
    initialPageParam: 1,
    enabled: enabled && !!connectionId && !!sql.trim(),
    staleTime: 0, // Always consider query results stale for real-time data
    gcTime: 5 * 60 * 1000 // Keep in cache for 5 minutes
  })
}

// Hook for exporting all data (no pagination)
export function useExportQuery(connectionId: string, sql: string) {
  return useQuery({
    queryKey: [...queryKeys.query(connectionId, sql), 'export'],
    queryFn: async (): Promise<any[]> => {
      const result = await window.api.database.query(
        connectionId,
        sql.trim(),
        undefined, // sessionId
        undefined // no pagination = get all data
      )

      if (result.success && result.data) {
        return result.data
      }
      return []
    },
    enabled: false, // Only run when manually triggered
    staleTime: 0,
    gcTime: 1 * 60 * 1000 // Keep export data for 1 minute only
  })
}
