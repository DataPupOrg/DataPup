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
    queryTable: (connectionId: string, options: any, sessionId?: string) =>
      ipcRenderer.invoke('db:queryTable', connectionId, options, sessionId),
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
      ipcRenderer.invoke('db:getPrimaryKeys', connectionId, table, database),
    getConnectionInfo: (connectionId: string) =>
      ipcRenderer.invoke('db:getConnectionInfo', connectionId)
  },
  connections: {
    getAll: () => ipcRenderer.invoke('connections:getAll'),
    getById: (id: string) => ipcRenderer.invoke('connections:getById', id),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id),
    updateLastUsed: (id: string) => ipcRenderer.invoke('connections:updateLastUsed', id),
    update: (id: string, updates: any) => ipcRenderer.invoke('connections:update', id, updates)
  },
  ai: {
    process: (request: any) => ipcRenderer.invoke('ai:process', request)
  },
  on: (channel: string, callback: (event: any, ...args: any[]) => void) => {
    const validChannels = ['ai:toolCall']
    if (validChannels.includes(channel)) {
      const listener = (_event: any, ...args: any[]) => callback(_event, ...args)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
    return () => {}
  },
  secureStorage: {
    get: (key: string) => ipcRenderer.invoke('secureStorage:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('secureStorage:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('secureStorage:delete', key)
  },
  queryHistory: {
    get: (filter?: any) => ipcRenderer.invoke('query-history:get', filter),
    clear: (connectionId?: string) => ipcRenderer.invoke('query-history:clear', connectionId),
    delete: (id: number) => ipcRenderer.invoke('query-history:delete', id),
    statistics: (connectionId?: string) =>
      ipcRenderer.invoke('query-history:statistics', connectionId)
  },
  savedQueries: {
    save: (query: any) => ipcRenderer.invoke('saved-queries:save', query),
    get: (filter?: any) => ipcRenderer.invoke('saved-queries:get', filter),
    update: (id: number, updates: any) => ipcRenderer.invoke('saved-queries:update', id, updates),
    delete: (id: number) => ipcRenderer.invoke('saved-queries:delete', id)
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
