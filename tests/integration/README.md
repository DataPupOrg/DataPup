# Database Integration Tests

## Overview
Integration tests verify that DataPup correctly interacts with real database systems. These tests are essential for ensuring compatibility and catching issues that unit tests might miss.

## Test Strategy

### 1. Local Development Testing
Use Docker containers for consistent, isolated test databases:

```bash
# Start test databases
docker-compose -f tests/integration/docker-compose.test.yml up -d

# Run integration tests
npm run test:integration

# Stop test databases
docker-compose -f tests/integration/docker-compose.test.yml down
```

### 2. CI/CD Testing
GitHub Actions uses service containers for database testing (see `.github/workflows/test.yml`).

### 3. Test Database Setup

#### PostgreSQL Test Database
- Creates a dedicated test database
- Uses transactions for test isolation
- Rolls back changes after each test
- Supports parallel test execution

#### ClickHouse Test Database
- Uses separate test tables with timestamps
- Cleans up test data after completion
- Handles ClickHouse's eventual consistency

## Environment Variables

### PostgreSQL
```bash
export TEST_POSTGRESQL_URL=true  # Enable PostgreSQL tests
export TEST_POSTGRESQL_HOST=localhost
export TEST_POSTGRESQL_PORT=5432
export TEST_POSTGRESQL_DB=datapup_test
export TEST_POSTGRESQL_USER=test_user
export TEST_POSTGRESQL_PASSWORD=test_password
```

### ClickHouse
```bash
export TEST_CLICKHOUSE_URL=true  # Enable ClickHouse tests
export TEST_CLICKHOUSE_HOST=localhost
export TEST_CLICKHOUSE_PORT=8123
export TEST_CLICKHOUSE_DB=datapup_test
export TEST_CLICKHOUSE_USER=default
export TEST_CLICKHOUSE_PASSWORD=
```

## Test Patterns

### 1. Connection Tests
```typescript
it('should connect to database', async () => {
  const result = await dbManager.testConnection(config)
  expect(result.success).toBe(true)
})
```

### 2. Query Execution Tests
```typescript
it('should execute queries', async () => {
  const result = await dbManager.query(connectionId, 'SELECT 1')
  expect(result.success).toBe(true)
})
```

### 3. CRUD Operations Tests
```typescript
it('should perform CRUD operations', async () => {
  // Create test table
  await dbManager.query(connectionId, createTableSQL)
  
  // Insert
  const insertResult = await dbManager.insertRow(...)
  
  // Update
  const updateResult = await dbManager.updateRow(...)
  
  // Delete
  const deleteResult = await dbManager.deleteRow(...)
  
  // Cleanup
  await dbManager.query(connectionId, 'DROP TABLE test_table')
})
```

### 4. Bulk Operations Tests
```typescript
it('should handle bulk operations', async () => {
  const operations = [
    { type: 'insert', ... },
    { type: 'update', ... },
    { type: 'delete', ... }
  ]
  
  const result = await dbManager.executeBulkOperations(connectionId, operations)
  expect(result.success).toBe(true)
})
```

## Test Isolation

### Using Transactions (PostgreSQL)
```typescript
beforeEach(async () => {
  await dbManager.query(connectionId, 'BEGIN')
})

afterEach(async () => {
  await dbManager.query(connectionId, 'ROLLBACK')
})
```

### Using Temporary Tables
```typescript
const testTableName = `test_table_${Date.now()}_${Math.random().toString(36)}`
```

### Cleanup Utilities
```typescript
async function cleanupTestData(connectionId: string, tablePrefix: string) {
  const tables = await dbManager.getTables(connectionId)
  const testTables = tables.filter(t => t.startsWith(tablePrefix))
  
  for (const table of testTables) {
    await dbManager.query(connectionId, `DROP TABLE IF EXISTS ${table}`)
  }
}
```

## Running Tests

### All Integration Tests
```bash
npm run test:integration
```

### Specific Database Tests
```bash
# PostgreSQL only
TEST_POSTGRESQL_URL=true npm run test:integration

# ClickHouse only
TEST_CLICKHOUSE_URL=true npm run test:integration
```

### With Docker
```bash
# Start databases and run tests
npm run test:integration:docker
```

## Debugging

### Enable Debug Logging
```bash
DEBUG=datapup:* npm run test:integration
```

### Run Single Test
```bash
npx vitest run tests/integration/database-connection.test.ts -t "should connect"
```

### Inspect Test Database
```bash
# PostgreSQL
docker exec -it datapup-test-postgres psql -U test_user -d datapup_test

# ClickHouse
docker exec -it datapup-test-clickhouse clickhouse-client --database datapup_test
```

## Best Practices

1. **Always clean up**: Remove test tables/data after tests
2. **Use unique names**: Prefix test objects with timestamps
3. **Handle timeouts**: Set appropriate timeouts for slow operations
4. **Test error cases**: Include negative tests for error handling
5. **Isolate tests**: Each test should be independent
6. **Mock when appropriate**: Use integration tests only when needed
7. **Document requirements**: Clear setup instructions for contributors