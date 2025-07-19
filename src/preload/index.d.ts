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
      }
      ai: {
        process: (request: any) => Promise<{
          success: boolean
          sqlQuery?: string
          explanation?: string
          queryResult?: any
          error?: string
        }>
        generateSQL: (request: any) => Promise<{
          success: boolean
          sql?: string
          explanation?: string
          error?: string
        }>
        getSchema: (
          connectionId: string,
          database?: string
        ) => Promise<{
          success: boolean
          schema?: any
          error?: string
        }>
        validateQuery: (
          sql: string,
          connectionId: string
        ) => Promise<{
          success: boolean
          isValid: boolean
          error?: string
        }>
      }
      secureStorage: {
        get: (key: string) => Promise<{ success: boolean; value: string | null }>
        set: (key: string, value: string) => Promise<{ success: boolean }>
        delete: (key: string) => Promise<{ success: boolean }>
      }
    }
  }
}
