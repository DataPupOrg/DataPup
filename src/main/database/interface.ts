export interface DatabaseConfig {
  type: string
  host: string
  port: number
  database: string
  username: string
  password: string
  readonly?: boolean // If true, only SELECT queries are allowed
  [key: string]: any // Additional database-specific options
}

export interface DatabaseCapabilities {
  supportsTransactions: boolean
  supportsBatchOperations: boolean
  supportsReturning: boolean
  supportsUpsert: boolean
  supportsSchemas: boolean
  requiresPrimaryKey: boolean
  defaultSchema?: string
}

export interface ConnectionResult {
  success: boolean
  message: string
  connectionId?: string
  error?: string
}

export enum QueryType {
  SELECT = 'SELECT',
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  DDL = 'DDL', // CREATE, ALTER, DROP
  SYSTEM = 'SYSTEM', // SHOW, DESCRIBE, etc.
  OTHER = 'OTHER'
}

export interface PaginationOptions {
  page?: number // 1-based page number, default: 1
  limit?: number // number of records per page, default: 100
}

export interface PaginationInfo {
  currentPage: number // current page number (1-based)
  pageSize: number // number of records per page
  totalCount?: number // total number of records available
  totalPages?: number // total number of pages
  hasMore: boolean // whether more pages are available
  hasPrevious: boolean // whether previous pages are available
}

export interface QueryResult {
  success: boolean
  data?: any[]
  message: string
  error?: string
  queryType?: QueryType
  affectedRows?: number
  isDDL?: boolean
  isDML?: boolean
  pagination?: PaginationInfo // pagination info for SELECT queries
}

export interface InsertResult extends QueryResult {
  insertedId?: string | number
  insertedIds?: Array<string | number>
}

export interface UpdateResult extends QueryResult {
  affectedRows: number
}

export interface DeleteResult extends QueryResult {
  affectedRows: number
}

export interface ColumnSchema {
  name: string
  type: string
  nullable?: boolean
  default?: string
  isPrimaryKey?: boolean
  isUnique?: boolean
}

export interface TableSchema {
  columns: ColumnSchema[]
  primaryKeys: string[]
  uniqueKeys: string[][]
}

export interface TransactionHandle {
  id: string
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

export interface BulkOperation {
  type: 'insert' | 'update' | 'delete'
  table: string
  data?: Record<string, any>
  where?: Record<string, any>
  primaryKey?: Record<string, any>
  database?: string
}

export interface BulkOperationResult {
  success: boolean
  results: Array<QueryResult>
  warning?: string
  error?: string
  data?: any[] // Updated rows after operations
}

export interface DatabaseManagerInterface {
  // Connection management
  connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult>
  disconnect(connectionId: string): Promise<{ success: boolean; message: string }>
  isConnected(connectionId: string): boolean
  isReadOnly(connectionId: string): boolean

  // Query execution
  query(
    connectionId: string,
    sql: string,
    sessionId?: string,
    pagination?: PaginationOptions
  ): Promise<QueryResult>
  cancelQuery(connectionId: string, queryId: string): Promise<{ success: boolean; message: string }>

  // CRUD operations
  insertRow(
    connectionId: string,
    table: string,
    data: Record<string, any>,
    database?: string
  ): Promise<InsertResult>
  updateRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    updates: Record<string, any>,
    database?: string
  ): Promise<UpdateResult>
  deleteRow(
    connectionId: string,
    table: string,
    primaryKey: Record<string, any>,
    database?: string
  ): Promise<DeleteResult>

  // Metadata operations
  getDatabases(
    connectionId: string
  ): Promise<{ success: boolean; databases?: string[]; message: string }>
  getTables(
    connectionId: string,
    database?: string
  ): Promise<{ success: boolean; tables?: string[]; message: string }>
  getTableSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: any[]; message: string }>
  getTableFullSchema(
    connectionId: string,
    tableName: string,
    database?: string
  ): Promise<{ success: boolean; schema?: TableSchema; message: string }>

  // Connection info
  getConnectionInfo(connectionId: string): { host: string; port: number; database: string } | null
  getAllConnections(): string[]
  getCapabilities(): DatabaseCapabilities

  // Transaction support
  supportsTransactions(connectionId: string): Promise<boolean>
  beginTransaction(connectionId: string): Promise<TransactionHandle>
  executeBulkOperations(
    connectionId: string,
    operations: BulkOperation[]
  ): Promise<BulkOperationResult>

  // Primary key management
  getPrimaryKeys(connectionId: string, table: string, database?: string): Promise<string[]>

  // Cleanup
  cleanup(): Promise<void>
}
