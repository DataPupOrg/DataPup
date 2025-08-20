declare global {
  interface Window {
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
          sql: string,
          sessionId?: string
        ) => Promise<{ success: boolean; data?: any[]; message: string; error?: string }>
        queryTable: (
          connectionId: string,
          options: {
            database: string
            table: string
            filters?: Array<{
              column: string
              operator:
                | '='
                | '!='
                | '>'
                | '<'
                | '>='
                | '<='
                | 'LIKE'
                | 'NOT LIKE'
                | 'IN'
                | 'NOT IN'
                | 'IS NULL'
                | 'IS NOT NULL'
              value?: string | string[] | number | number[]
            }>
            orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
            limit?: number
            offset?: number
          },
          sessionId?: string
        ) => Promise<{ success: boolean; data?: any[]; message: string; error?: string }>
        cancelQuery: (
          connectionId: string,
          queryId: string
        ) => Promise<{ success: boolean; message: string }>
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
        getTableFullSchema: (
          connectionId: string,
          tableName: string,
          database?: string
        ) => Promise<{
          success: boolean
          schema?: {
            columns: Array<{
              name: string
              type: string
              nullable?: boolean
              default?: string
              isPrimaryKey?: boolean
              isUnique?: boolean
            }>
            primaryKeys: string[]
            uniqueKeys: string[][]
          }
          message: string
        }>
        insertRow: (
          connectionId: string,
          table: string,
          data: Record<string, any>,
          database?: string
        ) => Promise<{
          success: boolean
          message: string
          error?: string
          insertedId?: string | number
        }>
        updateRow: (
          connectionId: string,
          table: string,
          primaryKey: Record<string, any>,
          updates: Record<string, any>,
          database?: string
        ) => Promise<{ success: boolean; message: string; error?: string; affectedRows: number }>
        deleteRow: (
          connectionId: string,
          table: string,
          primaryKey: Record<string, any>,
          database?: string
        ) => Promise<{ success: boolean; message: string; error?: string; affectedRows: number }>
        supportsTransactions: (connectionId: string) => Promise<boolean>
        executeBulkOperations: (
          connectionId: string,
          operations: Array<{
            type: 'insert' | 'update' | 'delete'
            table: string
            data?: Record<string, any>
            where?: Record<string, any>
            primaryKey?: Record<string, any>
            database?: string
          }>
        ) => Promise<{
          success: boolean
          results: Array<any>
          warning?: string
          error?: string
          data?: any[]
        }>
        getPrimaryKeys: (
          connectionId: string,
          table: string,
          database?: string
        ) => Promise<string[]>
        getConnectionInfo: (connectionId: string) => Promise<{
          success: boolean
          info: { host: string; port: number; database: string; type: string } | null
        }>
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

export {}
