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

export interface QueryResult {
  success: boolean
  data?: any[]
  message: string
  error?: string
  queryType?: QueryType
  affectedRows?: number
  isDDL?: boolean
  isDML?: boolean
  totalRows?: number // Total rows available (for pagination)
  hasMore?: boolean // Indicates if there are more rows beyond current result set
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

export interface TableFilter {
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
}

export interface TableQueryOptions {
  database: string
  table: string
  filters?: TableFilter[]
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
  limit?: number
  offset?: number
}

export interface DatabaseManagerInterface {
  // Connection management
  connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult>
  disconnect(connectionId: string): Promise<{ success: boolean; message: string }>
  isConnected(connectionId: string): boolean
  isReadOnly(connectionId: string): boolean

  // Query execution
  query(connectionId: string, sql: string, sessionId?: string): Promise<QueryResult>
  cancelQuery(connectionId: string, queryId: string): Promise<{ success: boolean; message: string }>

  // Table query with filters
  queryTable(
    connectionId: string,
    options: TableQueryOptions,
    sessionId?: string
  ): Promise<QueryResult>

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
  getConnectionInfo(
    connectionId: string
  ): { host: string; port: number; database: string; type: string } | null
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

// Query Performance Analysis Interfaces
export interface ExecutionPlanAnalysis {
  rawPlan: any
  queryType: QueryType
  planSummary: string
  databaseType: string
  executionTimeMs?: number
  estimatedCost?: number
  actualRows?: number
  estimatedRows?: number
  note: string
}

export interface QueryPerformanceResult {
  success: boolean
  executionPlan?: any
  analysis?: ExecutionPlanAnalysis
  originalQuery: string
  explainQuery?: string
  databaseType?: string
  database?: string
  error?: string
  attemptedQuery?: string
}

export interface DatabaseExplainConfig {
  postgresql: string
  mysql: string
  clickhouse: string
  default: string
}

export interface DatabaseSchema {
  database: string
  tables: TableSchemaInfo[]
}

export interface TableSchemaInfo {
  name: string
  columns: ColumnSchema[]
}
