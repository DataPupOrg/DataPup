import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './useQuery'

// Hook for query operations that may affect cached data
export function useDatabaseMutation(connectionId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ sql, sessionId }: { sql: string; sessionId?: string }) => {
      const startTime = Date.now()
      const result = await window.api.database.query(connectionId, sql.trim(), sessionId)
      const executionTime = Date.now() - startTime

      return {
        ...result,
        executionTime
      }
    },
    onSuccess: (data, variables) => {
      // Invalidate all queries for this connection if the mutation affects data
      const sql = variables.sql.trim().toUpperCase()
      const isDataModifyingQuery =
        sql.startsWith('INSERT') ||
        sql.startsWith('UPDATE') ||
        sql.startsWith('DELETE') ||
        sql.startsWith('CREATE') ||
        sql.startsWith('DROP') ||
        sql.startsWith('ALTER')

      if (isDataModifyingQuery) {
        // Invalidate all cached queries for this connection
        queryClient.invalidateQueries({
          queryKey: queryKeys.connection(connectionId)
        })
      }
    }
  })
}

// Hook for canceling queries
export function useCancelQuery(connectionId: string) {
  return useMutation({
    mutationFn: async (queryId: string) => {
      return await window.api.database.cancelQuery(connectionId, queryId)
    }
  })
}

// Utility to invalidate all queries for a connection
export function useInvalidateConnection() {
  const queryClient = useQueryClient()

  return (connectionId: string) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.connection(connectionId)
    })
  }
}

// Utility to clear all query cache
export function useClearQueryCache() {
  const queryClient = useQueryClient()

  return () => {
    queryClient.clear()
  }
}
