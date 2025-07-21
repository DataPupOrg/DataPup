/**
 * Test file for pagination functionality
 * Run manually to test various SQL scenarios
 */

interface TestCase {
  name: string
  sql: string
  expectedPagination: boolean
  expectedLimit?: number
  expectedOffset?: number
  description: string
}

const testCases: TestCase[] = [
  // Basic SELECT queries - should apply pagination
  {
    name: 'Basic SELECT',
    sql: 'SELECT * FROM users',
    expectedPagination: true,
    expectedLimit: 100,
    expectedOffset: 0,
    description: 'Should apply default pagination (100 records, page 1)'
  },
  {
    name: 'SELECT with WHERE',
    sql: 'SELECT id, name FROM users WHERE age > 18',
    expectedPagination: true,
    expectedLimit: 100,
    expectedOffset: 0,
    description: 'Should apply pagination to filtered SELECT'
  },
  {
    name: 'Complex SELECT with JOIN',
    sql: 'SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id',
    expectedPagination: true,
    expectedLimit: 100,
    expectedOffset: 0,
    description: 'Should apply pagination to JOIN queries'
  },
  {
    name: 'SELECT with CTE',
    sql: 'WITH recent_users AS (SELECT * FROM users WHERE created_at > NOW() - INTERVAL 30 DAY) SELECT * FROM recent_users',
    expectedPagination: true,
    expectedLimit: 100,
    expectedOffset: 0,
    description: 'Should apply pagination to CTE queries'
  },

  // Queries with existing LIMIT - pagination behavior depends on limit size
  {
    name: 'SELECT with small LIMIT',
    sql: 'SELECT * FROM users LIMIT 10',
    expectedPagination: false,
    description: 'Should NOT apply pagination when user LIMIT is smaller than page size'
  },
  {
    name: 'SELECT with large LIMIT',
    sql: 'SELECT * FROM users LIMIT 500',
    expectedPagination: true,
    expectedLimit: 100,
    expectedOffset: 0,
    description: 'Should apply pagination even when user LIMIT is larger (overrides user LIMIT)'
  },
  {
    name: 'SELECT with LIMIT and OFFSET',
    sql: 'SELECT * FROM users LIMIT 50 OFFSET 100',
    expectedPagination: false,
    description: 'Should NOT apply pagination when user has specified LIMIT <= page size'
  },

  // Non-SELECT queries - should NOT apply pagination
  {
    name: 'INSERT statement',
    sql: "INSERT INTO users (name, email) VALUES ('John', 'john@example.com')",
    expectedPagination: false,
    description: 'Should NOT apply pagination to INSERT'
  },
  {
    name: 'UPDATE statement',
    sql: 'UPDATE users SET active = 1 WHERE id = 123',
    expectedPagination: false,
    description: 'Should NOT apply pagination to UPDATE'
  },
  {
    name: 'DELETE statement',
    sql: 'DELETE FROM users WHERE active = 0',
    expectedPagination: false,
    description: 'Should NOT apply pagination to DELETE'
  },
  {
    name: 'CREATE TABLE',
    sql: 'CREATE TABLE test (id INT PRIMARY KEY, name VARCHAR(255))',
    expectedPagination: false,
    description: 'Should NOT apply pagination to DDL'
  },
  {
    name: 'SHOW TABLES',
    sql: 'SHOW TABLES',
    expectedPagination: false,
    description: 'Should NOT apply pagination to SYSTEM queries'
  },
  {
    name: 'DESCRIBE table',
    sql: 'DESCRIBE users',
    expectedPagination: false,
    description: 'Should NOT apply pagination to DESCRIBE'
  },

  // Edge cases
  {
    name: 'Empty query',
    sql: '',
    expectedPagination: false,
    description: 'Should handle empty query gracefully'
  },
  {
    name: 'Whitespace only',
    sql: '   \n  \t  ',
    expectedPagination: false,
    description: 'Should handle whitespace-only query'
  },
  {
    name: 'Case insensitive SELECT',
    sql: 'select * from USERS',
    expectedPagination: true,
    expectedLimit: 100,
    expectedOffset: 0,
    description: 'Should handle case-insensitive SELECT'
  },
  {
    name: 'SELECT with comments',
    sql: '/* Get all users */ SELECT * FROM users -- This is a comment',
    expectedPagination: true,
    expectedLimit: 100,
    expectedOffset: 0,
    description: 'Should handle queries with comments'
  }
]

// Test pagination scenarios
const paginationScenarios = [
  { page: 1, limit: 100, expectedOffset: 0 },
  { page: 2, limit: 100, expectedOffset: 100 },
  { page: 3, limit: 50, expectedOffset: 100 },
  { page: 1, limit: 25, expectedOffset: 0 },
  { page: 5, limit: 200, expectedOffset: 800 }
]

console.log('=== Pagination Test Cases ===')
console.log('\nThis file contains test cases for validating pagination functionality.')
console.log('Run these tests manually in the DataPup application:')
console.log('\n1. Connect to a ClickHouse database with sufficient data')
console.log('2. Execute each SQL query below')
console.log('3. Verify pagination behavior matches expectations')

console.log('\n=== SQL Query Test Cases ===')
testCases.forEach((testCase, index) => {
  console.log(`\n${index + 1}. ${testCase.name}`)
  console.log(`   SQL: ${testCase.sql}`)
  console.log(`   Expected: ${testCase.description}`)
  if (testCase.expectedPagination) {
    console.log(`   Should show: Page 1 of ? with ${testCase.expectedLimit} records`)
  } else {
    console.log(`   Should show: No pagination controls`)
  }
})

console.log('\n=== Pagination Control Test Cases ===')
console.log('\nTest pagination controls with this query: SELECT * FROM [large_table]')
paginationScenarios.forEach((scenario, index) => {
  console.log(`\n${index + 1}. Page ${scenario.page}, ${scenario.limit} rows per page`)
  console.log(`   Expected OFFSET: ${scenario.expectedOffset}`)
  console.log(
    `   Expected SQL: SELECT * FROM [table] LIMIT ${scenario.limit} OFFSET ${scenario.expectedOffset}`
  )
})

console.log('\n=== Export Test Cases ===')
console.log('\n1. Execute a query that returns >100 records')
console.log('2. Verify export dropdown shows "Current Page" and "All Data" options')
console.log('3. Test exporting current page (should export ~100 records)')
console.log('4. Test exporting all data (should export all records)')
console.log('5. Verify filename includes page info for current page export')
console.log('6. Verify filename includes total count for all data export')

export { testCases, paginationScenarios }
