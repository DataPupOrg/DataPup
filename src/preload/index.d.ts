import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      database: {
        connect: (
          config: any
        ) => Promise<{ success: boolean; message: string; connectionId?: string; error?: string }>
        testConnection: (
          config: any
        ) => Promise<{ success: boolean; message: string; error?: string }>
        disconnect: (
          connectionId?: string
        ) => Promise<{ success: boolean; message: string; error?: string }>
        query: (
          connectionId: string,
          sql: string
        ) => Promise<{ success: boolean; data?: any[]; message: string; error?: string }>
        getDatabases: (
          connectionId: string
        ) => Promise<{ success: boolean; databases?: string[]; message: string; error?: string }>
        getTables: (
          connectionId: string,
          database?: string
        ) => Promise<{ success: boolean; tables?: string[]; message: string; error?: string }>
        getTableSchema: (
          connectionId: string,
          tableName: string,
          database?: string
        ) => Promise<{ success: boolean; schema?: any[]; message: string; error?: string }>
        isConnected: (connectionId: string) => Promise<{ success: boolean; isConnected: boolean }>
        isReadOnly: (connectionId: string) => Promise<{ success: boolean; isReadOnly: boolean }>
        getSupportedTypes: () => Promise<{ success: boolean; types: string[] }>
        getAllConnections: () => Promise<{ success: boolean; connections: string[] }>
      }
      connections: {
        getAll: () => Promise<{ success: boolean; connections: any[] }>
        getById: (id: string) => Promise<{ success: boolean; connection: any | null }>
        delete: (id: string) => Promise<{ success: boolean }>
        updateLastUsed: (id: string) => Promise<{ success: boolean }>
        update: (id: string, updates: any) => Promise<{ success: boolean; message?: string }>
      }
      ai: {
        process: (request: {
          query: string
          connectionId: string
          database?: string
          provider?: 'openai' | 'claude' | 'gemini'
          sessionId?: string
        }) => Promise<{
          success: boolean
          message?: string
          sqlQuery?: string
          explanation?: string
          error?: string
        }>
      }
      on: (channel: string, callback: (event: any, ...args: any[]) => void) => () => void
      secureStorage: {
        get: (key: string) => Promise<{ success: boolean; value: string | null }>
        set: (key: string, value: string) => Promise<{ success: boolean }>
        delete: (key: string) => Promise<{ success: boolean }>
      }
      queryHistory: {
        get: (filter?: {
          connectionId?: string
          connectionType?: string
          startDate?: string
          endDate?: string
          success?: boolean
          searchTerm?: string
          limit?: number
          offset?: number
        }) => Promise<{
          success: boolean
          history: Array<{
            id: number
            connectionId: string
            connectionType: string
            connectionName: string
            query: string
            executionTime?: number
            rowCount?: number
            success: boolean
            errorMessage?: string
            createdAt: string
          }>
        }>
        clear: (connectionId?: string) => Promise<{ success: boolean; deletedCount: number }>
        delete: (id: number) => Promise<{ success: boolean }>
        statistics: (connectionId?: string) => Promise<{
          success: boolean
          stats: {
            totalQueries: number
            successfulQueries: number
            failedQueries: number
            averageExecutionTime: number
          } | null
        }>
      }
      savedQueries: {
        save: (query: {
          name: string
          description?: string
          query: string
          connectionType?: string
          tags?: string[]
        }) => Promise<{ success: boolean; id: number | null }>
        get: (filter?: {
          connectionType?: string
          tags?: string[]
          searchTerm?: string
          limit?: number
          offset?: number
        }) => Promise<{
          success: boolean
          queries: Array<{
            id: number
            name: string
            description?: string
            query: string
            connectionType?: string
            tags: string[]
            createdAt: string
            updatedAt: string
          }>
        }>
        update: (
          id: number,
          updates: {
            name?: string
            description?: string
            query?: string
            connectionType?: string
            tags?: string[]
          }
        ) => Promise<{ success: boolean }>
        delete: (id: number) => Promise<{ success: boolean }>
      }
    }
  }
}
