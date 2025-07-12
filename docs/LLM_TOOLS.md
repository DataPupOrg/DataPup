# LLM Tools for DataPup

This document describes the comprehensive set of Langchain-compatible tools available for LLMs in DataPup. These tools enable LLMs to interact with databases, validate queries, and provide enhanced functionality for SQL generation and data analysis.

## Overview

The tools are organized into 9 categories, each providing specific functionality for database operations and AI-assisted SQL generation:

1. **Schema Introspection** - Explore database structure
2. **Sample Data** - Understand data distribution
3. **Query Execution** - Run and explain queries
4. **Validation & Correction** - Validate and fix SQL
5. **Metadata & Documentation** - Access table/column descriptions
6. **Data Export/Import** - Export results and import data
7. **User Context** - Access user preferences and connection info
8. **AI Assistant** - Summarize results and suggest visualizations
9. **Security & Safety** - Safety checks and user confirmations

## Tool Categories

### 1. Schema Introspection Tools

#### `get_table_list`

- **Description**: List all tables in the current database
- **Parameters**: None
- **Returns**: Array of table names
- **Use Case**: Understand available tables for query generation

#### `get_table_schema`

- **Description**: Get the schema (columns, types) for a specific table
- **Parameters**: `table` (string) - The table name
- **Returns**: Array of column definitions with name and type
- **Use Case**: Understand table structure for accurate SQL generation

#### `get_foreign_keys`

- **Description**: Get foreign key relationships for a table
- **Parameters**: `table` (string) - The table name
- **Returns**: Array of foreign key relationships
- **Use Case**: Understand table relationships for JOIN operations

#### `get_indexes`

- **Description**: Get indexes for a table
- **Parameters**: `table` (string) - The table name
- **Returns**: Array of index definitions
- **Use Case**: Optimize queries using available indexes

### 2. Sample Data Tools

#### `get_sample_rows`

- **Description**: Get sample rows from a table to understand data distribution
- **Parameters**:
  - `table` (string) - The table name
  - `limit` (number, optional) - Number of sample rows (default: 5)
- **Returns**: Array of sample rows
- **Use Case**: Understand data format and content for better query generation

#### `get_distinct_values`

- **Description**: Get distinct values for a column (useful for WHERE clause suggestions)
- **Parameters**:
  - `table` (string) - The table name
  - `column` (string) - The column name
  - `limit` (number, optional) - Number of distinct values (default: 10)
- **Returns**: Array of distinct values
- **Use Case**: Suggest valid values for WHERE clauses

### 3. Query Execution Tools

#### `run_sql_query`

- **Description**: Execute a SQL query and return the result (with safety checks)
- **Parameters**:
  - `query` (string) - The SQL query to execute
  - `limit` (number, optional) - Maximum number of rows to return (default: 100)
- **Returns**: Query results with success status and row count
- **Use Case**: Execute generated SQL and get results

#### `explain_sql_query`

- **Description**: Get the query plan or explanation for a SQL statement
- **Parameters**: `query` (string) - The SQL query to explain
- **Returns**: Query execution plan and estimated cost
- **Use Case**: Understand query performance and optimization opportunities

### 4. Validation & Correction Tools

#### `validate_sql_syntax`

- **Description**: Check if a SQL query is valid for the current database
- **Parameters**: `query` (string) - The SQL query to validate
- **Returns**: Validation result with error details if invalid
- **Use Case**: Validate generated SQL before execution

#### `suggest_correction`

- **Description**: Given an error message, suggest a corrected query
- **Parameters**:
  - `query` (string) - The original SQL query
  - `error` (string) - The error message from the database
- **Returns**: Corrected query with explanation
- **Use Case**: Fix SQL errors automatically

### 5. Metadata & Documentation Tools

#### `get_table_description`

- **Description**: Get comments or documentation for a table
- **Parameters**: `table` (string) - The table name
- **Returns**: Table description and purpose
- **Use Case**: Understand table purpose for better query context

#### `get_column_description`

- **Description**: Get comments or documentation for a specific column
- **Parameters**:
  - `table` (string) - The table name
  - `column` (string) - The column name
- **Returns**: Column description and data meaning
- **Use Case**: Understand column purpose and data semantics

#### `list_recent_queries`

- **Description**: Get a history of recent queries for context
- **Parameters**: `limit` (number, optional) - Number of recent queries (default: 10)
- **Returns**: Array of recent queries with timestamps
- **Use Case**: Provide context from previous queries

### 6. Data Export/Import Tools

#### `export_query_result`

- **Description**: Export the result of a query to CSV, JSON, etc.
- **Parameters**:
  - `query` (string) - The SQL query to execute and export
  - `format` (string) - Export format (csv, json, excel)
  - `filename` (string, optional) - Output filename
- **Returns**: Export status and file information
- **Use Case**: Export query results for analysis or sharing

#### `import_data`

- **Description**: Import data from a file into a table
- **Parameters**:
  - `table` (string) - The target table name
  - `filepath` (string) - Path to the file to import
  - `format` (string) - File format (csv, json, excel)
  - `options` (string, optional) - Additional import options as JSON
- **Returns**: Import status and row count
- **Use Case**: Import external data for analysis

### 7. User Context Tools

#### `get_user_preferences`

- **Description**: Get user preferences for query generation and display
- **Parameters**: None
- **Returns**: User preferences object
- **Use Case**: Personalize query generation based on user preferences

#### `get_active_connection_info`

- **Description**: Get information about the currently active database connection
- **Parameters**: None
- **Returns**: Connection information object
- **Use Case**: Provide database-specific context for query generation

### 8. AI Assistant Tools

#### `summarize_query_result`

- **Description**: Generate a natural language summary of query results
- **Parameters**:
  - `query` (string) - The SQL query that was executed
  - `resultData` (string) - JSON string of the query result data
  - `summaryType` (string, optional) - Type of summary (brief, detailed, insights)
- **Returns**: Natural language summary with key insights
- **Use Case**: Provide human-readable summaries of query results

#### `generate_visualization`

- **Description**: Suggest appropriate visualizations for query results
- **Parameters**:
  - `query` (string) - The SQL query that was executed
  - `resultData` (string) - JSON string of the query result data
  - `visualizationType` (string, optional) - Preferred chart type
- **Returns**: Visualization recommendations with chart configuration
- **Use Case**: Suggest appropriate charts for data visualization

### 9. Security & Safety Tools

#### `check_query_safety`

- **Description**: Check if a SQL query is safe to execute (no dangerous operations)
- **Parameters**: `query` (string) - The SQL query to check for safety
- **Returns**: Safety assessment with warnings and recommendations
- **Use Case**: Prevent dangerous operations like DROP, DELETE without WHERE

#### `request_user_confirmation`

- **Description**: Request user confirmation for potentially dangerous operations
- **Parameters**:
  - `operation` (string) - Description of the operation requiring confirmation
  - `query` (string) - The SQL query that needs confirmation
  - `riskLevel` (string) - Risk level (low, medium, high)
- **Returns**: Confirmation requirements and suggested alternatives
- **Use Case**: Ensure user awareness of potentially destructive operations

## Usage Examples

### Basic SQL Generation

```typescript
import { getEssentialTools } from './tools'

const tools = getEssentialTools()
// Use with Langchain agent for basic SQL generation
```

### Advanced Data Analysis

```typescript
import { getAdvancedTools } from './tools'

const tools = getAdvancedTools()
// Use with Langchain agent for complex data analysis
```

### Category-Specific Tools

```typescript
import { getToolsByCategory } from './tools'

const schemaTools = getToolsByCategory.schema
const validationTools = getToolsByCategory.validation
// Use specific tool categories as needed
```

## Integration with Langchain

All tools are Langchain-compatible and can be used with:

1. **Langchain Agents** - For autonomous SQL generation and execution
2. **Tool Chains** - For specific workflows like data exploration
3. **Custom Chains** - For specialized database operations

## Safety Features

The tools include several safety mechanisms:

1. **Query Validation** - Check for dangerous operations
2. **User Confirmation** - Request approval for risky operations
3. **Result Limits** - Prevent overwhelming result sets
4. **Error Handling** - Graceful handling of database errors

## Future Enhancements

Planned improvements include:

1. **Real Database Integration** - Connect to actual database systems
2. **Performance Monitoring** - Track query performance metrics
3. **Advanced Analytics** - Statistical analysis of query results
4. **Custom Tool Creation** - Allow users to create custom tools
5. **Tool Chaining** - Automatic tool selection based on context

## Contributing

To add new tools:

1. Create a new class extending `StructuredTool`
2. Define the tool schema with proper types
3. Implement the `_call` method with appropriate logic
4. Add the tool to the appropriate category in exports
5. Update this documentation

## Testing

Tools can be tested individually or as part of the complete toolset:

```typescript
import { allTools } from './tools'

// Test individual tool
const tableListTool = new GetTableListTool()
const result = await tableListTool._call({})

// Test tool integration
const agent = new Agent({ tools: allTools })
```
