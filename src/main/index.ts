import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SecureStorage, DatabaseConnection } from './secureStorage'
import { DatabaseManager } from './database/manager'
import { DatabaseConfig, TableQueryOptions } from './database/interface'
import { LangChainAgent } from './llm/langchainAgent'
import QueryHistoryService from './services/QueryHistoryService'
import * as fs from 'fs'

function createWindow(): void {
  const iconPath = is.dev
    ? join(__dirname, '../../build/icons/icon.svg')
    : join(process.resourcesPath, 'icons/icon.svg')

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'DataPup',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Initialize secure storage and database manager
const secureStorage = new SecureStorage()
const databaseManager = new DatabaseManager()
const queryHistoryService = new QueryHistoryService()

// Initialize AI agent
const aiAgent = new LangChainAgent(databaseManager, secureStorage)

app.whenReady().then(() => {
  // Set the app name for macOS menu bar
  app.setName('DataPup')
  electronApp.setAppUserModelId('com.datapup')

  // Set dock icon for macOS
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = is.dev
      ? join(__dirname, '../../build/icons/icon.png')
      : join(process.resourcesPath, 'icons/icon.png')

    // Check if the icon file exists before setting
    if (fs.existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
    }
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC handlers for database operations
ipcMain.handle('db:testConnection', async (_, connectionConfig) => {
  try {
    console.log('Testing connection with config:', connectionConfig)
    const result = await databaseManager.testConnection(connectionConfig as DatabaseConfig)
    return result
  } catch (error) {
    console.error('Test connection error:', error)
    return {
      success: false,
      message: 'Test connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle('db:connect', async (_, connectionConfig) => {
  try {
    console.log('Main process received connection config:', connectionConfig)
    console.log('Secure flag in config:', connectionConfig.secure)

    // Generate a unique ID for the connection
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Create connection object
    const connection: DatabaseConnection = {
      id: connectionId,
      name:
        connectionConfig.label ||
        `${connectionConfig.type} - ${connectionConfig.host}:${connectionConfig.port}`,
      type: connectionConfig.type,
      host: connectionConfig.host,
      port: connectionConfig.port,
      database: connectionConfig.database,
      username: connectionConfig.username,
      password: connectionConfig.password,
      secure: connectionConfig.secure,
      readonly: connectionConfig.readonly,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    }

    // Save connection securely if requested
    if (connectionConfig.saveConnection !== false) {
      secureStorage.saveConnection(connection)
    }

    // Connect to the actual database
    const dbResult = await databaseManager.connect(connectionConfig as DatabaseConfig, connectionId)

    if (dbResult.success) {
      return {
        success: true,
        message: dbResult.message,
        connectionId: connectionId
      }
    } else {
      return {
        success: false,
        message: dbResult.message,
        error: dbResult.error
      }
    }
  } catch (error) {
    console.error('Connection error:', error)
    return {
      success: false,
      message: 'Connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle('db:disconnect', async (_, connectionId?: string) => {
  try {
    if (connectionId) {
      const result = await databaseManager.disconnect(connectionId)
      return result
    } else {
      // Disconnect all active connections
      await databaseManager.cleanup()
      return { success: true, message: 'All connections closed' }
    }
  } catch (error) {
    console.error('Disconnection error:', error)
    return {
      success: false,
      message: 'Failed to disconnect',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle('db:query', async (_, connectionId: string, query: string, sessionId?: string) => {
  const startTime = Date.now()
  try {
    const result = await databaseManager.query(connectionId, query, sessionId)

    // Get connection info for history
    const connectionInfo = databaseManager.getConnectionInfo(connectionId)
    if (connectionInfo) {
      const savedConnection = secureStorage.getConnection(connectionId)
      queryHistoryService.addQueryToHistory({
        connectionId,
        connectionType: connectionInfo.type || 'unknown',
        connectionName: savedConnection?.name || `${connectionInfo.host}:${connectionInfo.port}`,
        query,
        executionTime: Date.now() - startTime,
        rowCount: result.data?.length,
        success: result.success,
        errorMessage: result.error
      })
    }

    return result
  } catch (error) {
    console.error('Query execution error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Also log failed queries
    const connectionInfo = databaseManager.getConnectionInfo(connectionId)
    if (connectionInfo) {
      const savedConnection = secureStorage.getConnection(connectionId)
      queryHistoryService.addQueryToHistory({
        connectionId,
        connectionType: connectionInfo.type || 'unknown',
        connectionName: savedConnection?.name || `${connectionInfo.host}:${connectionInfo.port}`,
        query,
        executionTime: Date.now() - startTime,
        success: false,
        errorMessage
      })
    }

    return {
      success: false,
      message: 'Query execution failed',
      error: errorMessage
    }
  }
})

ipcMain.handle(
  'db:queryTable',
  async (_, connectionId: string, options: TableQueryOptions, sessionId?: string) => {
    try {
      const result = await databaseManager.queryTable(connectionId, options, sessionId)
      return result
    } catch (error) {
      console.error('Table query execution error:', error)
      return {
        success: false,
        message: 'Table query execution failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

ipcMain.handle('db:cancelQuery', async (_, connectionId: string, queryId: string) => {
  try {
    const result = await databaseManager.cancelQuery(connectionId, queryId)
    return result
  } catch (error) {
    console.error('Query cancellation error:', error)
    return {
      success: false,
      message: 'Failed to cancel query',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

// IPC handlers for connection management
ipcMain.handle('connections:getAll', async () => {
  try {
    const connections = secureStorage.getConnections()
    return { success: true, connections }
  } catch (error) {
    console.error('Error getting connections:', error)
    return { success: false, connections: [] }
  }
})

ipcMain.handle('connections:getById', async (_, id: string) => {
  try {
    const connection = secureStorage.getConnection(id)
    return { success: true, connection }
  } catch (error) {
    console.error('Error getting connection:', error)
    return { success: false, connection: null }
  }
})

ipcMain.handle('connections:delete', async (_, id: string) => {
  try {
    const deleted = secureStorage.deleteConnection(id)
    return { success: deleted }
  } catch (error) {
    console.error('Error deleting connection:', error)
    return { success: false }
  }
})

ipcMain.handle('connections:updateLastUsed', async (_, id: string) => {
  try {
    secureStorage.updateLastUsed(id)
    return { success: true }
  } catch (error) {
    console.error('Error updating last used:', error)
    return { success: false }
  }
})

ipcMain.handle('connections:update', async (_, id: string, updates: any) => {
  try {
    const updated = secureStorage.updateConnection(id, updates)
    return { success: updated }
  } catch (error) {
    console.error('Error updating connection:', error)
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Additional database operation handlers
ipcMain.handle('db:getDatabases', async (_, connectionId: string) => {
  try {
    const result = await databaseManager.getDatabases(connectionId)
    return result
  } catch (error) {
    console.error('Error getting databases:', error)
    return {
      success: false,
      message: 'Failed to get databases',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle('db:getTables', async (_, connectionId: string, database?: string) => {
  try {
    const result = await databaseManager.getTables(connectionId, database)
    return result
  } catch (error) {
    console.error('Error getting tables:', error)
    return {
      success: false,
      message: 'Failed to get tables',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

ipcMain.handle(
  'db:getTableSchema',
  async (_, connectionId: string, tableName: string, database?: string) => {
    try {
      const result = await databaseManager.getTableSchema(connectionId, tableName, database)
      return result
    } catch (error) {
      console.error('Error getting table schema:', error)
      return {
        success: false,
        message: 'Failed to get table schema',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

ipcMain.handle('db:isConnected', async (_, connectionId: string) => {
  try {
    const isConnected = databaseManager.isConnected(connectionId)
    return { success: true, isConnected }
  } catch (error) {
    console.error('Error checking connection status:', error)
    return { success: false, isConnected: false }
  }
})

ipcMain.handle('db:isReadOnly', async (_, connectionId: string) => {
  try {
    const isReadOnly = databaseManager.isReadOnly(connectionId)
    return { success: true, isReadOnly }
  } catch (error) {
    console.error('Error checking read-only status:', error)
    return { success: false, isReadOnly: false }
  }
})

ipcMain.handle('db:supportsTransactions', async (_, connectionId: string) => {
  try {
    return await databaseManager.supportsTransactions(connectionId)
  } catch (error) {
    console.error('Error checking transaction support:', error)
    return false
  }
})

ipcMain.handle('db:executeBulkOperations', async (_, connectionId: string, operations: any[]) => {
  try {
    return await databaseManager.executeBulkOperations(connectionId, operations)
  } catch (error) {
    console.error('Bulk operations error:', error)
    return {
      success: false,
      results: [],
      error: error instanceof Error ? error.message : 'Bulk operations failed'
    }
  }
})

ipcMain.handle(
  'db:getPrimaryKeys',
  async (_, connectionId: string, table: string, database?: string) => {
    try {
      return await databaseManager.getPrimaryKeys(connectionId, table, database)
    } catch (error) {
      console.error('Error getting primary keys:', error)
      return []
    }
  }
)

ipcMain.handle('db:getSupportedTypes', async () => {
  try {
    const supportedTypes = databaseManager.getSupportedDatabaseTypes()
    return { success: true, types: supportedTypes }
  } catch (error) {
    console.error('Error getting supported database types:', error)
    return { success: false, types: [] }
  }
})

ipcMain.handle('db:getAllConnections', async () => {
  try {
    const connections = databaseManager.getAllConnections()
    return { success: true, connections }
  } catch (error) {
    console.error('Error getting all connections:', error)
    return { success: false, connections: [] }
  }
})

ipcMain.handle('db:getConnectionInfo', async (_, connectionId: string) => {
  try {
    const info = databaseManager.getConnectionInfo(connectionId)
    return { success: true, info }
  } catch (error) {
    console.error('Error getting connection info:', error)
    return { success: false, info: null }
  }
})

// IPC handler for AI processing
ipcMain.handle('ai:process', async (_, request) => {
  try {
    console.log('Processing AI query:', request.query)
    const result = await aiAgent.processQuery(request)
    console.log('AI query result:', result)
    return result
  } catch (error) {
    console.error('AI query error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
})

// IPC handlers for secure storage
ipcMain.handle('secureStorage:get', async (_, key: string) => {
  try {
    const value = secureStorage.get(key)
    return { success: true, value }
  } catch (error) {
    console.error('Error getting from secure storage:', error)
    return { success: false, value: null }
  }
})

ipcMain.handle('secureStorage:set', async (_, key: string, value: string) => {
  try {
    secureStorage.set(key, value)
    return { success: true }
  } catch (error) {
    console.error('Error setting in secure storage:', error)
    return { success: false }
  }
})

ipcMain.handle('secureStorage:delete', async (_, key: string) => {
  try {
    secureStorage.delete(key)
    return { success: true }
  } catch (error) {
    console.error('Error deleting from secure storage:', error)
    return { success: false }
  }
})

// IPC handlers for query history
ipcMain.handle('query-history:get', async (_, filter) => {
  try {
    const history = queryHistoryService.getQueryHistory(filter)
    return { success: true, history }
  } catch (error) {
    console.error('Error getting query history:', error)
    return { success: false, history: [] }
  }
})

ipcMain.handle('query-history:clear', async (_, connectionId?: string) => {
  try {
    const deletedCount = queryHistoryService.clearHistory(connectionId)
    return { success: true, deletedCount }
  } catch (error) {
    console.error('Error clearing query history:', error)
    return { success: false, deletedCount: 0 }
  }
})

ipcMain.handle('query-history:delete', async (_, id: number) => {
  try {
    const deleted = queryHistoryService.deleteHistoryEntry(id)
    return { success: deleted }
  } catch (error) {
    console.error('Error deleting query history entry:', error)
    return { success: false }
  }
})

ipcMain.handle('query-history:statistics', async (_, connectionId?: string) => {
  try {
    const stats = queryHistoryService.getStatistics(connectionId)
    return { success: true, stats }
  } catch (error) {
    console.error('Error getting query statistics:', error)
    return { success: false, stats: null }
  }
})

// IPC handlers for saved queries
ipcMain.handle('saved-queries:save', async (_, query) => {
  try {
    const id = queryHistoryService.saveQuery(query)
    return { success: true, id }
  } catch (error) {
    console.error('Error saving query:', error)
    return { success: false, id: null }
  }
})

ipcMain.handle('saved-queries:get', async (_, filter) => {
  try {
    const queries = queryHistoryService.getSavedQueries(filter)
    return { success: true, queries }
  } catch (error) {
    console.error('Error getting saved queries:', error)
    return { success: false, queries: [] }
  }
})

ipcMain.handle('saved-queries:update', async (_, id: number, updates) => {
  try {
    const updated = queryHistoryService.updateSavedQuery(id, updates)
    return { success: updated }
  } catch (error) {
    console.error('Error updating saved query:', error)
    return { success: false }
  }
})

ipcMain.handle('saved-queries:delete', async (_, id: number) => {
  try {
    const deleted = queryHistoryService.deleteSavedQuery(id)
    return { success: deleted }
  } catch (error) {
    console.error('Error deleting saved query:', error)
    return { success: false }
  }
})

// IPC handlers for CRUD operations
ipcMain.handle(
  'db:getTableFullSchema',
  async (_, connectionId: string, tableName: string, database?: string) => {
    try {
      const result = await databaseManager.getTableFullSchema(connectionId, tableName, database)
      return result
    } catch (error) {
      console.error('Error getting table full schema:', error)
      return {
        success: false,
        message: 'Failed to get table full schema',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

ipcMain.handle(
  'db:insertRow',
  async (_, connectionId: string, table: string, data: Record<string, any>, database?: string) => {
    try {
      const result = await databaseManager.insertRow(connectionId, table, data, database)
      return result
    } catch (error) {
      console.error('Error inserting row:', error)
      return {
        success: false,
        message: 'Failed to insert row',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

ipcMain.handle(
  'db:updateRow',
  async (
    _,
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    updates: Record<string, any>,
    database?: string
  ) => {
    try {
      const result = await databaseManager.updateRow(
        connectionId,
        table,
        primaryKey,
        updates,
        database
      )
      return result
    } catch (error) {
      console.error('Error updating row:', error)
      return {
        success: false,
        message: 'Failed to update row',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)

ipcMain.handle(
  'db:deleteRow',
  async (
    _,
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    database?: string
  ) => {
    try {
      const result = await databaseManager.deleteRow(connectionId, table, primaryKey, database)
      return result
    } catch (error) {
      console.error('Error deleting row:', error)
      return {
        success: false,
        message: 'Failed to delete row',
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
)
