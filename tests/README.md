# DataPup Testing Framework

## Overview
This testing framework provides a robust foundation for testing the DataPup application. It uses Vitest as the test runner and includes support for unit tests, component tests, and integration tests.

## Stack
- **Vitest**: Fast, Vite-native test runner
- **@testing-library/react**: React component testing utilities
- **@testing-library/jest-dom**: DOM matchers for assertions
- **happy-dom**: Fast DOM implementation for testing
- **c8**: Code coverage reporting

## Running Tests

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run integration tests only
npm run test:integration
```

## Project Structure

```
tests/
├── helpers/           # Test utilities and setup files
│   ├── setup.ts      # Global test setup
│   ├── setup-main.ts # Main process test setup
│   ├── setup-renderer.ts # Renderer process test setup
│   ├── setup-integration.ts # Integration test setup
│   └── test-utils.tsx # React testing utilities
├── fixtures/         # Test data and mocks
│   └── test-data.ts  # Shared test fixtures
├── integration/      # Integration tests
│   └── database-connection.test.ts
└── README.md        # This file

src/
├── main/
│   └── database/
│       └── __tests__/  # Database unit tests
│           ├── manager.test.ts
│           └── postgresql.test.ts
└── renderer/
    └── components/
        └── __tests__/  # Component tests
            └── DatabaseConnection.test.tsx
```

## Writing Tests

### Unit Tests
Place unit tests next to the code they test in `__tests__` directories:

```typescript
// src/main/database/__tests__/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { DatabaseManager } from '../manager'

describe('DatabaseManager', () => {
  it('should connect to database', async () => {
    // Test implementation
  })
})
```

### Component Tests
Use React Testing Library for component tests:

```typescript
// src/renderer/components/__tests__/MyComponent.test.tsx
import { render, screen } from '@tests/helpers/test-utils'
import MyComponent from '../MyComponent'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Expected text')).toBeInTheDocument()
  })
})
```

### Integration Tests
Place integration tests in the `tests/integration` directory:

```typescript
// tests/integration/feature.test.ts
import { describe, it, expect } from 'vitest'

describe('Feature Integration', () => {
  it('should work end-to-end', async () => {
    // Integration test
  })
})
```

## Mocking

### Mock Electron APIs
Electron APIs are automatically mocked in the test setup files:

```typescript
// Mocked in setup-renderer.ts
window.electron.database.query = vi.fn()
```

### Mock External Dependencies
Use Vitest's mocking capabilities:

```typescript
vi.mock('pg', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    query: vi.fn(),
    end: vi.fn()
  }))
}))
```

## Environment Variables

For integration tests, set these environment variables:

```bash
# PostgreSQL
TEST_POSTGRESQL_HOST=localhost
TEST_POSTGRESQL_PORT=5432
TEST_POSTGRESQL_DB=test_db
TEST_POSTGRESQL_USER=test_user
TEST_POSTGRESQL_PASSWORD=password

# ClickHouse
TEST_CLICKHOUSE_HOST=localhost
TEST_CLICKHOUSE_PORT=8123
TEST_CLICKHOUSE_DB=default
TEST_CLICKHOUSE_USER=default
TEST_CLICKHOUSE_PASSWORD=
```

## Coverage

Coverage reports are generated in the `coverage/` directory:

```bash
npm run test:coverage
```

Coverage thresholds can be configured in `vitest.config.ts`.

## CI/CD

Tests run automatically on:
- Push to main branch
- Pull requests to main branch

See `.github/workflows/test.yml` for CI configuration.

## Contributing

When adding new features:
1. Write tests alongside your code
2. Follow existing test patterns
3. Ensure tests pass locally before pushing
4. Include both positive and negative test cases
5. Mock external dependencies appropriately

## Troubleshooting

### Tests not found
- Ensure test files follow naming convention: `*.test.ts` or `*.spec.ts`
- Check that tests are in correct directories

### Module resolution errors
- Path aliases are configured in `vitest.workspace.ts`
- Use `@tests` for test helpers and fixtures
- Use `@` for renderer code

### Mocking issues
- Clear mocks between tests: `vi.clearAllMocks()`
- Restore mocks after tests: `vi.restoreAllMocks()`

### Integration test failures
- Check environment variables are set correctly
- Ensure test databases are running and accessible
- Use `skipIfNoDatabase()` helper for optional tests