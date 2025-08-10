# Integration Tests

## Overview
DataPup uses **Testcontainers** for integration testing. This provides automatic container lifecycle management and true test isolation.

## Requirements
- Docker Desktop or Docker Engine
- Node.js 20+

## Running Tests

```bash
# Run all integration tests
npm run test:integration

# Skip if Docker unavailable
SKIP_CONTAINER_TESTS=true npm run test:integration
```

## How It Works

Testcontainers automatically:
1. Starts fresh database containers for each test suite
2. Allocates random ports (no conflicts)
3. Waits for databases to be ready
4. Cleans up containers after tests complete

## Test Structure

```typescript
describe('PostgreSQL', () => {
  let pgContainer: PostgreSQLTestContainer
  
  beforeAll(async () => {
    pgContainer = new PostgreSQLTestContainer()
    const setup = await pgContainer.start()
    // Use setup.dbManager and setup.connectionId
  }, 60000)
  
  afterAll(async () => {
    await pgContainer.stop()
  })
})
```

## Available Helpers

- `PostgreSQLTestContainer`: PostgreSQL container management
- `ClickHouseTestContainer`: ClickHouse container management
- `TestTableHelper`: Create/drop test tables with unique names
- `executeInTransaction()`: Run PostgreSQL tests in rolled-back transactions

## Benefits

✅ **No manual setup** - Containers start automatically  
✅ **True isolation** - Fresh database for each test suite  
✅ **CI/CD ready** - Works in GitHub Actions without configuration  
✅ **No port conflicts** - Dynamic port allocation  
✅ **Automatic cleanup** - Containers removed after tests  

## Writing New Tests

1. Import helpers from `testcontainer-helpers.ts`
2. Start container in `beforeAll` with appropriate timeout
3. Stop container in `afterAll`
4. Use `TestTableHelper` for table management
5. Clean up test data after each test

## Troubleshooting

**Docker not available:**
```bash
docker version  # Check Docker status
```

**Container startup timeout:**
Increase timeout in beforeAll: `}, 120000)`

**Debugging failed tests:**
Remove `.skip` and run individual test with verbose output