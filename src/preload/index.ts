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
    getAllConnections: () => ipcRenderer.invoke('db:getAllConnections')
  },
  connections: {
    getAll: () => ipcRenderer.invoke('connections:getAll'),
    getById: (id: string) => ipcRenderer.invoke('connections:getById', id),
    delete: (id: string) => ipcRenderer.invoke('connections:delete', id),
    updateLastUsed: (id: string) => ipcRenderer.invoke('connections:updateLastUsed', id)
  },
  naturalLanguageQuery: {
    process: (request: any) => ipcRenderer.invoke('nlq:process', request),
    generateSQL: (request: any) => ipcRenderer.invoke('nlq:generateSQL', request),
    getSchema: (connectionId: string, database?: string) =>
      ipcRenderer.invoke('nlq:getSchema', connectionId, database),
    validateQuery: (sql: string, connectionId: string) =>
      ipcRenderer.invoke('nlq:validateQuery', sql, connectionId)
  },
  secureStorage: {
    get: (key: string) => ipcRenderer.invoke('secureStorage:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('secureStorage:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('secureStorage:delete', key)
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
