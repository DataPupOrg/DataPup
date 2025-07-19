import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SecureStorage, DatabaseConnection } from './secureStorage'
import { DatabaseManager } from './database/manager'
import { DatabaseConfig } from './database/interface'
import { NaturalLanguageQueryProcessor } from './services/naturalLanguageQueryProcessor'
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

// Initialize natural language query processor
const naturalLanguageQueryProcessor = new NaturalLanguageQueryProcessor(
  databaseManager,
  secureStorage
)

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
  try {
    const result = await databaseManager.query(connectionId, query, sessionId)
    return result
  } catch (error) {
    console.error('Query execution error:', error)
    return {
      success: false,
      message: 'Query execution failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

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

// IPC handlers for natural language queries
ipcMain.handle('nlq:process', async (_, request) => {
  try {
    console.log('Processing natural language query:', request.naturalLanguageQuery)
    let result = await naturalLanguageQueryProcessor.processNaturalLanguageQuery(request)
    let hops = 0
    const MAX_HOPS = 3
    // Tool call chaining loop
    while (
      result.toolCalls &&
      result.toolCalls.some((tc) => tc.description && tc.description.startsWith('TOOL_CALL:')) &&
      hops < MAX_HOPS
    ) {
      const toolCall = result.toolCalls.find((tc) => tc.description && tc.description.startsWith('TOOL_CALL:'))
      if (!toolCall) break
      // Parse tool name and args from description
      const match = /TOOL_CALL: (\w+)\((.*)\)/.exec(toolCall.description)
      if (!match) break
      const toolName = match[1]
      const argsString = match[2]
      // Parse args (very basic, assumes key="value" pairs)
      const args: Record<string, any> = {}
      argsString.split(',').forEach((pair: string) => {
        const [key, value] = pair.split('=')
        if (key && value) {
          args[key.trim()] = value.trim().replace(/^"|"$/g, '')
        }
      })
      if (!args.connectionId) args.connectionId = request.connectionId
      // Use a public method to get the tool handler
      try {
        if (typeof naturalLanguageQueryProcessor.getToolByName !== 'function') break
        const toolHandler = naturalLanguageQueryProcessor.getToolByName(toolName)
        if (!toolHandler) break
        const toolResult: any = await toolHandler(args)
        // Attach toolResult to result generically
        ;(result as any).toolResult = toolResult
      } catch (error) {
        console.error('Tool execution error:', error)
      }
      break
    }
    console.log('Natural language query result:', result)
    return result
  } catch (error) {
    console.error('Natural language query error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
})

ipcMain.handle('nlq:generateSQL', async (_, request) => {
  try {
    console.log('Generating SQL from natural language:', request.naturalLanguageQuery)
    const result = await naturalLanguageQueryProcessor.generateSQLOnly(request)
    console.log('SQL generation result:', result)
    return result
  } catch (error) {
    console.error('SQL generation error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
})

ipcMain.handle('nlq:getSchema', async (_, connectionId: string, database?: string) => {
  try {
    const schema = await naturalLanguageQueryProcessor.getDatabaseSchema(connectionId, database)
    if (schema) {
      return {
        success: true,
        schema,
        formattedSchema: naturalLanguageQueryProcessor.formatSchemaForDisplay(schema)
      }
    } else {
      return {
        success: false,
        error: 'Failed to retrieve database schema'
      }
    }
  } catch (error) {
    console.error('Schema retrieval error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
})

ipcMain.handle('nlq:validateQuery', async (_, sql: string, connectionId: string) => {
  try {
    const result = await naturalLanguageQueryProcessor.validateGeneratedQuery(sql, connectionId)
    return result
  } catch (error) {
    console.error('Query validation error:', error)
    return {
      isValid: false,
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

// In-memory stores for AI tools
const aiLastErrors: Record<string, any> = {}
const aiConversationContexts: Record<string, any> = {}

ipcMain.handle('ai:listDatabases', async (_, connectionId) => {
  return await databaseManager.getDatabases(connectionId)
})
ipcMain.handle('ai:listTables', async (_, connectionId, database) => {
  return await databaseManager.getTables(connectionId, database)
})
ipcMain.handle('ai:getTableSchema', async (_, connectionId, tableName, database) => {
  return await databaseManager.getTableSchema(connectionId, tableName, database)
})
ipcMain.handle('ai:getSampleRows', async (_, connectionId, database, tableName, limit = 5) => {
  const query = `SELECT * FROM ${database ? `${database}.` : ''}${tableName} LIMIT ${limit}`
  try {
    const result = await databaseManager.query(connectionId, query)
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})
ipcMain.handle('ai:executeQuery', async (_, connectionId, sql) => {
  try {
    const result = await databaseManager.query(connectionId, sql)
    if (!result.success) aiLastErrors[connectionId] = result.error
    return result
  } catch (error) {
    aiLastErrors[connectionId] = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: aiLastErrors[connectionId] }
  }
})
ipcMain.handle('ai:getLastError', async (_, connectionId) => {
  return { error: aiLastErrors[connectionId] || null }
})
ipcMain.handle('ai:searchTables', async (_, connectionId, pattern, database) => {
  const tablesResult = await databaseManager.getTables(connectionId, database)
  if (!tablesResult.success || !tablesResult.tables) return tablesResult
  const filtered = tablesResult.tables.filter((t) => t.includes(pattern))
  return { success: true, tables: filtered }
})
ipcMain.handle('ai:searchColumns', async (_, connectionId, pattern, database) => {
  const tablesResult = await databaseManager.getTables(connectionId, database)
  if (!tablesResult.success || !tablesResult.tables) return tablesResult
  let columns = []
  for (const table of tablesResult.tables) {
    const schemaResult = await databaseManager.getTableSchema(connectionId, table, database)
    if (schemaResult.success && schemaResult.schema) {
      columns.push(
        ...schemaResult.schema
          .filter((col) => (col.name || col[0] || '').includes(pattern))
          .map((col) => ({ table, column: col.name || col[0] }))
      )
    }
  }
  return { success: true, columns }
})
ipcMain.handle('ai:summarizeSchema', async (_, connectionId, database) => {
  const schema = await global.schemaIntrospector.getDatabaseSchema(connectionId, database)
  if (!schema) return { success: false, error: 'Failed to get schema' }
  // Simple summary for now
  let summary =
    `Database ${schema.database} has ${schema.tables.length} tables: ` +
    schema.tables.map((t) => t.name).join(', ')
  return { success: true, summary }
})
ipcMain.handle('ai:summarizeTable', async (_, connectionId, tableName, database) => {
  const schemaResult = await databaseManager.getTableSchema(connectionId, tableName, database)
  if (!schemaResult.success || !schemaResult.schema)
    return { success: false, error: 'Failed to get table schema' }
  const columns = schemaResult.schema.map((col) => col.name || col[0]).join(', ')
  return { success: true, summary: `Table ${tableName} has columns: ${columns}` }
})
ipcMain.handle('ai:profileTable', async (_, connectionId, tableName, database) => {
  // Simple profile: count, min/max for numeric columns
  const schemaResult = await databaseManager.getTableSchema(connectionId, tableName, database)
  if (!schemaResult.success || !schemaResult.schema)
    return { success: false, error: 'Failed to get table schema' }
  const columns = schemaResult.schema
  let profile = {}
  for (const col of columns) {
    const name = col.name || col[0]
    const type = col.type || col[1]
    if (type && (type.includes('Int') || type.includes('Float') || type.includes('Decimal'))) {
      const minmax = await databaseManager.query(
        connectionId,
        `SELECT min(${name}) as min, max(${name}) as max FROM ${database ? `${database}.` : ''}${tableName}`
      )
      if (minmax.success && minmax.data && minmax.data[0]) {
        profile[name] = { min: minmax.data[0].min, max: minmax.data[0].max }
      }
    }
  }
  return { success: true, profile }
})
ipcMain.handle('ai:getConversationContext', async (_, sessionId) => {
  return { context: aiConversationContexts[sessionId] || null }
})
ipcMain.handle('ai:setConversationContext', async (_, sessionId, context) => {
  aiConversationContexts[sessionId] = context
  return { success: true }
})
ipcMain.handle('ai:getDocumentation', async (_, topic) => {
  // For now, return a static message. Later, fetch from docs or web.
  return { doc: `Documentation for ${topic} is not yet implemented.` }
})
