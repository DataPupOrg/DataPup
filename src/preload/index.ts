import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  database: {
    connect: (config: any) => ipcRenderer.invoke('db:connect', config),
    testConnection: (config: any) => ipcRenderer.invoke('db:testConnection', config),
    disconnect: (connectionId?: string) => ipcRenderer.invoke('db:disconnect', connectionId),
    query: (connectionId: string, sql: string, sessionId?: string) =>
      ipcRenderer.invoke('db:query', connectionId, sql, sessionId),
    cancelQuery: (connectionId: string, queryId: string) =>
      ipcRenderer.invoke('db:cancelQuery', connectionId, queryId),
    getDatabases: (connectionId: string) => ipcRenderer.invoke('db:getDatabases', connectionId),
    getTables: (connectionId: string, database?: string) =>
      ipcRenderer.invoke('db:getTables', connectionId, database),
    getTableSchema: (connectionId: string, tableName: string, database?: string) =>
      ipcRenderer.invoke('db:getTableSchema', connectionId, tableName, database),
    getTableFullSchema: (connectionId: string, tableName: string, database?: string) =>
      ipcRenderer.invoke('db:getTableFullSchema', connectionId, tableName, database),
    insertRow: (
      connectionId: string,
      table: string,
      data: Record<string, any>,
      database?: string
    ) => ipcRenderer.invoke('db:insertRow', connectionId, table, data, database),
    updateRow: (
      connectionId: string,
      table: string,
      primaryKey: Record<string, any>,
      updates: Record<string, any>,
      database?: string
    ) => ipcRenderer.invoke('db:updateRow', connectionId, table, primaryKey, updates, database),
    deleteRow: (
      connectionId: string,
      table: string,
      primaryKey: Record<string, any>,
      database?: string
    ) => ipcRenderer.invoke('db:deleteRow', connectionId, table, primaryKey, database),
    isConnected: (connectionId: string) => ipcRenderer.invoke('db:isConnected', connectionId),
    isReadOnly: (connectionId: string) => ipcRenderer.invoke('db:isReadOnly', connectionId),
    getSupportedTypes: () => ipcRenderer.invoke('db:getSupportedTypes'),
    getAllConnections: () => ipcRenderer.invoke('db:getAllConnections'),
    supportsTransactions: (connectionId: string) =>
      ipcRenderer.invoke('db:supportsTransactions', connectionId),
    executeBulkOperations: (connectionId: string, operations: any[]) =>
      ipcRenderer.invoke('db:executeBulkOperations', connectionId, operations),
    getPrimaryKeys: (connectionId: string, table: string, database?: string) =>
      ipcRenderer.invoke('db:getPrimaryKeys', connectionId, table, database)
  },
  connections: {
    getAll: () => ipcRenderer.invoke('connections:getAll'),
    getById: (id: string) => ipcRenderer.invoke('connections:getById', id),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id),
    updateLastUsed: (id: string) => ipcRenderer.invoke('connections:updateLastUsed', id)
  },
  ai: {
    process: (request: any) => ipcRenderer.invoke('ai:process', request),
    generateSQL: (request: any) => ipcRenderer.invoke('ai:generateSQL', request),
    getSchema: (connectionId: string, database?: string) =>
      ipcRenderer.invoke('ai:getSchema', connectionId, database),
    validateQuery: (sql: string, connectionId: string) =>
      ipcRenderer.invoke('ai:validateQuery', sql, connectionId)
  },
  secureStorage: {
    get: (key: string) => ipcRenderer.invoke('secureStorage:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('secureStorage:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('secureStorage:delete', key)
  },
  aiTools: {
    listDatabases: (connectionId: string) => ipcRenderer.invoke('ai:listDatabases', connectionId),
    listTables: (connectionId: string, database?: string) =>
      ipcRenderer.invoke('ai:listTables', connectionId, database),
    getTableSchema: (connectionId: string, tableName: string, database?: string) =>
      ipcRenderer.invoke('ai:getTableSchema', connectionId, tableName, database),
    getSampleRows: (connectionId: string, database: string, tableName: string, limit?: number) =>
      ipcRenderer.invoke('ai:getSampleRows', connectionId, database, tableName, limit),
    executeQuery: (connectionId: string, sql: string) =>
      ipcRenderer.invoke('ai:executeQuery', connectionId, sql),
    getLastError: (connectionId: string) => ipcRenderer.invoke('ai:getLastError', connectionId),
    searchTables: (connectionId: string, pattern: string, database?: string) =>
      ipcRenderer.invoke('ai:searchTables', connectionId, pattern, database),
    searchColumns: (connectionId: string, pattern: string, database?: string) =>
      ipcRenderer.invoke('ai:searchColumns', connectionId, pattern, database),
    summarizeSchema: (connectionId: string, database?: string) =>
      ipcRenderer.invoke('ai:summarizeSchema', connectionId, database),
    summarizeTable: (connectionId: string, tableName: string, database?: string) =>
      ipcRenderer.invoke('ai:summarizeTable', connectionId, tableName, database),
    profileTable: (connectionId: string, tableName: string, database?: string) =>
      ipcRenderer.invoke('ai:profileTable', connectionId, tableName, database),
    getConversationContext: (sessionId: string) =>
      ipcRenderer.invoke('ai:getConversationContext', sessionId),
    setConversationContext: (sessionId: string, context: any) =>
      ipcRenderer.invoke('ai:setConversationContext', sessionId, context),
    getDocumentation: (topic: string) => ipcRenderer.invoke('ai:getDocumentation', topic)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  console.log('context isolated')
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  console.log('not context isolated')
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
