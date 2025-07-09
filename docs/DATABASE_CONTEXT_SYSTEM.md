# Database Context System

## Overview

The Database Context System is an **extensible framework** that provides database-specific context, functions, examples, and best practices to LLM providers. Currently implemented for **ClickHouse**, the system is designed to be easily extended for other database types in the future.

## Architecture

### Core Components

1. **DatabaseContext Interface** - Defines the structure for database-specific information
2. **DatabaseContextProvider** - Abstract base class for implementing database-specific providers
3. **DatabaseContextRegistry** - Global registry for managing all database context providers
4. **LLM Integration** - Updated LLM providers (Gemini, OpenAI, Claude) that use the context system

### Key Features

- **Extensible**: Easy to add new database types in the future
- **Rich Context**: Provides functions, examples, best practices, and features
- **Database-Specific**: Each database type has its own specialized knowledge
- **Automatic Integration**: LLM providers automatically use the appropriate context
- **Generic Design**: Architecture supports any database type

## Currently Supported Database Types

- **ClickHouse** - High-performance column-oriented database (currently implemented)

## How It Works

### 1. Context Provider Registration

Database context providers are automatically registered when the system starts:

```typescript
// In src/main/database/context/index.ts
databaseContextRegistry.register('clickhouse', new ClickHouseContextProvider())
```

### 2. LLM Integration

When an LLM generates SQL, it automatically:

1. Gets the database type from the request
2. Retrieves the appropriate context provider
3. Uses database-specific schema formatting
4. Includes database-specific instructions and examples

```typescript
// In LLM providers
const contextProvider = databaseContextRegistry.getProvider(databaseType)
const formattedSchema = contextProvider.formatSchema(databaseSchema)
const instructions = contextProvider.generatePromptInstructions()
```

### 3. Enhanced Schema Formatting

The system provides rich schema information including:
- Database type and description
- Table engines and constraints
- Column types and constraints
- Primary keys and relationships

## Adding a New Database Type (Future)

### Step 1: Create Context Provider

Create a new file `src/main/database/context/yourdb.ts`:

```typescript
import { DatabaseContextProvider, DatabaseContext } from '../context'

export class YourDBContextProvider extends DatabaseContextProvider {
  getContext(): DatabaseContext {
    return {
      databaseType: 'yourdb',
      displayName: 'Your Database',
      description: 'Description of your database',
      
      functions: {
        random: {
          integer: 'Your random integer function',
          selection: 'Your random selection function',
          number: 'Your random number function'
        },
        dateTime: {
          current: 'Your current timestamp function',
          format: 'Your date formatting function',
          arithmetic: 'Your date arithmetic function'
        },
        // ... other function categories
      },
      
      examples: {
        randomData: [
          'Example SQL for generating random data',
          'Another example'
        ],
        incrementalIds: [
          'Example for incremental IDs'
        ],
        // ... other example categories
      },
      
      bestPractices: [
        'Best practice 1',
        'Best practice 2',
        // ... more best practices
      ],
      
      dataTypes: {
        integer: ['INT', 'BIGINT', 'SMALLINT'],
        string: ['VARCHAR', 'TEXT', 'CHAR'],
        // ... other data types
      },
      
      queryPatterns: {
        insert: 'Your INSERT pattern',
        select: 'Your SELECT pattern',
        // ... other patterns
      },
      
      features: {
        supportsTransactions: true,
        supportsForeignKeys: true,
        // ... other features
      }
    }
  }
}
```

### Step 2: Register the Provider

Add your provider to `src/main/database/context/index.ts`:

```typescript
export * from './yourdb'

import { YourDBContextProvider } from './yourdb'

// Register the provider
databaseContextRegistry.register('yourdb', new YourDBContextProvider())
```

### Step 3: Test Integration

The system will automatically use your new database context when:
- A user connects to a database with type 'yourdb'
- The LLM generates SQL for that database type

## Context Categories

### Functions

Provides database-specific function syntax for:
- **Random**: Random number generation
- **DateTime**: Date and time operations
- **Aggregation**: COUNT, SUM, AVG, etc.
- **String**: String manipulation
- **Sequence**: ID generation and sequences
- **Custom**: Database-specific functions

### Examples

Real-world SQL examples for:
- **Random Data**: Generating test data
- **Incremental IDs**: Auto-incrementing IDs
- **DateTime Operations**: Date/time queries
- **Aggregations**: Group by and aggregation queries
- **Joins**: Table joins
- **Subqueries**: Nested queries
- **Custom**: Database-specific examples

### Best Practices

Database-specific recommendations for:
- Performance optimization
- Data type selection
- Index strategies
- Query patterns
- Security considerations

### Data Types

Supported data types for:
- **Integer**: Numeric types
- **String**: Text types
- **DateTime**: Date and time types
- **Boolean**: Boolean types
- **Decimal**: Decimal/numeric types
- **Custom**: Database-specific types

### Query Patterns

Standard query templates for:
- **INSERT**: Data insertion
- **SELECT**: Data retrieval
- **UPDATE**: Data modification
- **DELETE**: Data deletion
- **JOIN**: Table joins
- **Subquery**: Nested queries
- **Window**: Window functions

### Features

Database capabilities:
- **Transactions**: ACID compliance
- **Foreign Keys**: Referential integrity
- **Indexes**: Performance optimization
- **Views**: Virtual tables
- **Stored Procedures**: Programmable logic
- **Triggers**: Event-driven actions
- **Full-Text Search**: Text search capabilities
- **Custom**: Database-specific features

## Benefits

### For Users

1. **Accurate SQL**: Database-specific syntax and functions
2. **Better Examples**: Real-world, working examples
3. **Best Practices**: Database-specific recommendations
4. **Consistent Experience**: Same interface for all databases

### For Developers

1. **Easy Extension**: Simple to add new database types
2. **Maintainable**: Centralized database knowledge
3. **Testable**: Each provider can be tested independently
4. **Reusable**: Context can be used across different LLM providers

### For the System

1. **Scalable**: Easy to add new databases
2. **Consistent**: Uniform interface across all databases
3. **Rich Context**: Comprehensive database information
4. **Future-Proof**: Extensible architecture

## ClickHouse Implementation

### ClickHouse Context

When generating SQL for ClickHouse, the LLM receives:

```
CLICKHOUSE-SPECIFIC INSTRUCTIONS:

FUNCTIONS:
- Random integer: rand() % (max - min + 1) + min
- Random selection: arrayRand([item1, item2, item3])
- Random number: rand() (0-1), rand64() (0-2^64-1)
- Current timestamp: now(), toDateTime(now())
- Date formatting: toDate(), toDateTime(), formatDateTime()
- Count: count(), countDistinct()
- Sum: sum(), sumIf()
- Average: avg(), avgIf()
- Generate sequence: numbers(n) generates 0 to n-1
- Incremental ID: number + COALESCE((SELECT max(id) FROM table), 0)
- arrayJoin: Explode arrays into rows
- arrayMap: Apply function to array elements
- arrayFilter: Filter array elements
- quantile: Calculate quantiles
- median: Calculate median
- uniq: Count unique values
- topK: Get top K values

EXAMPLES:
Random Data Generation:
- INSERT INTO table SELECT rand() % 100 + 1, arrayRand(['A', 'B', 'C']) FROM numbers(1000)
- SELECT rand() % 10 + 1 as random_number, arrayRand([1,2,3,4,5]) as random_choice FROM numbers(10)

Incremental IDs:
- INSERT INTO orders SELECT number + COALESCE((SELECT max(id) FROM orders), 0) FROM numbers(100)
- INSERT INTO users SELECT number + (SELECT max(id) FROM users) FROM numbers(50)

BEST PRACTICES:
- Use MergeTree engine for most tables - provides best performance for analytical queries
- Choose appropriate primary key - affects query performance and storage efficiency
- Use materialized columns for frequently computed values
- Leverage columnar storage - only read columns you need
- Use FINAL keyword for deduplication in ReplacingMergeTree
- Use PREWHERE for better performance when filtering on indexed columns
- Use SAMPLE for approximate queries on large datasets
- Use appropriate data types - UInt32 vs Int32, String vs FixedString
- Use projections for complex aggregations
- Use dictionaries for small lookup tables

FEATURES:
- Transactions: Not Supported
- Foreign Keys: Not Supported
- Indexes: Supported
- Views: Supported
- Stored Procedures: Not Supported
- Triggers: Not Supported
- Full-Text Search: Supported
- Columnar Storage: Supported
- Compression: Supported
- Materialized Views: Supported
- Projections: Supported
- Dictionaries: Supported
- Replication: Supported
- Sharding: Supported
```

## Future Enhancements

### Planned Features

1. **Dynamic Context Loading**: Load context providers on-demand
2. **Context Versioning**: Support for different database versions
3. **Custom Context**: Allow users to define custom context
4. **Context Validation**: Validate context providers
5. **Performance Metrics**: Track context usage and effectiveness

### Potential Database Types for Future Implementation

- **PostgreSQL**: Advanced open-source relational database
- **MySQL**: Popular open-source relational database
- **SQLite**: Lightweight, embedded database
- **SQL Server**: Microsoft's enterprise database
- **Oracle**: Enterprise database system
- **MongoDB**: NoSQL document database
- **Redis**: In-memory data structure store
- **Cassandra**: Distributed NoSQL database

## Conclusion

The Database Context System provides a robust, extensible foundation for generating database-specific SQL queries. Currently implemented for ClickHouse, the system is designed to be easily extended for other database types in the future.

By centralizing database knowledge and providing rich context to LLM providers, it ensures accurate, efficient, and database-appropriate SQL generation. The extensible architecture allows new database types to be added with minimal effort while maintaining consistency across all LLM providers.

The system solves the original problem of incorrect ClickHouse SQL generation by providing comprehensive, ClickHouse-specific context to the LLM, while maintaining a generic architecture that can be extended for other databases in the future. 
