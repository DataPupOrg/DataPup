// Test fixtures for database tests
export const mockDatabaseConfig = {
  clickhouse: {
    type: 'clickhouse',
    host: 'localhost',
    port: 8123,
    database: 'test_db',
    username: 'test_user',
    password: 'test_password',
    secure: false,
    timeout: 5000
  },
  postgresql: {
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'test_db',
    username: 'test_user',
    password: 'test_password',
    ssl: false,
    timeout: 5000
  }
}

export const mockQueryResults = {
  success: {
    success: true,
    data: [
      { id: 1, name: 'Test 1', value: 100 },
      { id: 2, name: 'Test 2', value: 200 }
    ],
    message: 'Query executed successfully',
    affectedRows: 2
  },
  error: {
    success: false,
    error: 'Connection failed',
    message: 'Failed to connect to database',
    data: []
  }
}

export const mockTableSchema = {
  columns: [
    { name: 'id', type: 'integer', nullable: false, defaultValue: null },
    { name: 'name', type: 'varchar', nullable: false, defaultValue: null },
    { name: 'value', type: 'numeric', nullable: true, defaultValue: '0' }
  ],
  primaryKeys: ['id'],
  uniqueKeys: []
}

export const mockBulkOperations = [
  {
    type: 'insert' as const,
    table: 'test_table',
    data: { name: 'New Item', value: 300 }
  },
  {
    type: 'update' as const,
    table: 'test_table',
    primaryKey: { id: 1 },
    data: { value: 150 }
  },
  {
    type: 'delete' as const,
    table: 'test_table',
    primaryKey: { id: 2 }
  }
]