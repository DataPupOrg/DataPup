# Redis and MongoDB Implementation Design Proposal for DataPup

## Executive Summary

This document analyzes the feasibility of implementing Redis and MongoDB support in DataPup and proposes a design that leverages the existing architecture while accommodating the unique characteristics of NoSQL databases.

## Current Architecture Analysis

### Strengths
1. **Modular Database Manager Pattern**: The factory pattern and base class architecture make it easy to add new database types
2. **Type-Safe Interfaces**: Well-defined TypeScript interfaces provide clear contracts
3. **IPC Communication**: Clean separation between main and renderer processes
4. **Flexible UI Components**: TableView can be adapted for different data formats

### Challenges
1. **SQL-Centric Design**: Current interfaces assume SQL queries and relational concepts
2. **Fixed Schema Assumptions**: The system expects tables with columns, which doesn't map well to NoSQL
3. **CRUD Operations**: Current implementation assumes primary keys and row-based updates
4. **Query Language**: The query editor is designed for SQL syntax

## Feasibility Assessment

### Redis Implementation: HIGH FEASIBILITY ✅
- Redis commands map reasonably well to SQL-like operations
- Key-value pairs can be represented as a two-column table
- Redis data types (lists, sets, hashes) can be displayed in structured formats
- ioredis library provides excellent Node.js support

### MongoDB Implementation: MEDIUM FEASIBILITY ⚠️
- Document structure requires more UI adaptation
- MongoDB query language is significantly different from SQL
- Nested documents need specialized visualization
- Would benefit from a visual query builder

## Proposed Design

### 1. Base Class Modifications

```typescript
// Add to interface.ts
export enum DatabaseType {
  RELATIONAL = 'RELATIONAL',
  KEY_VALUE = 'KEY_VALUE',
  DOCUMENT = 'DOCUMENT',
  GRAPH = 'GRAPH'
}

export interface DatabaseCapabilities {
  // Existing fields...
  databaseType: DatabaseType
  supportsSQL: boolean
  supportsNativeQueries: boolean
  queryLanguage: 'SQL' | 'Redis' | 'MongoDB' | 'Custom'
  dataStructure: 'Tabular' | 'KeyValue' | 'Document' | 'Mixed'
}

// New interface for non-SQL queries
export interface NativeQuery {
  type: 'redis' | 'mongodb' | 'custom'
  command?: string // For Redis
  operation?: any // For MongoDB
  parameters?: any[]
}

// Extend QueryResult for different data formats
export interface QueryResult {
  // Existing fields...
  dataFormat?: 'table' | 'keyvalue' | 'document' | 'tree'
  metadata?: {
    keyType?: string // For Redis
    documentSchema?: any // For MongoDB
  }
}
```

### 2. Redis Manager Implementation

```typescript
class RedisManager extends BaseDatabaseManager {
  private clients: Map<string, Redis> = new Map()

  async connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult> {
    const client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: parseInt(config.database) || 0,
      tls: config.secure ? {} : undefined
    })
    
    // Store client and handle connection
  }

  async query(connectionId: string, command: string): Promise<QueryResult> {
    // Parse Redis commands and execute
    // Convert results to table format for display
  }

  // Override getDatabases to return Redis databases (0-15)
  async getDatabases(connectionId: string) {
    return {
      success: true,
      databases: Array.from({ length: 16 }, (_, i) => `db${i}`)
    }
  }

  // Override getTables to return key patterns/namespaces
  async getTables(connectionId: string, database?: string) {
    // Use SCAN to get key patterns
    // Group by namespace (e.g., user:*, session:*)
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      databaseType: DatabaseType.KEY_VALUE,
      supportsSQL: false,
      supportsNativeQueries: true,
      queryLanguage: 'Redis',
      dataStructure: 'KeyValue',
      // ... other capabilities
    }
  }
}
```

### 3. MongoDB Manager Implementation

```typescript
class MongoDBManager extends BaseDatabaseManager {
  private clients: Map<string, MongoClient> = new Map()

  async connect(config: DatabaseConfig, connectionId: string): Promise<ConnectionResult> {
    const url = `mongodb://${config.username}:${config.password}@${config.host}:${config.port}/${config.database}`
    const client = new MongoClient(url, {
      tls: config.secure,
      tlsAllowInvalidCertificates: false
    })
    
    await client.connect()
    // Store client
  }

  async query(connectionId: string, query: string): Promise<QueryResult> {
    // Parse MongoDB query syntax or JSON
    // Execute using MongoDB driver
    // Return with document format
  }

  // Collections as "tables"
  async getTables(connectionId: string, database?: string) {
    const db = this.getDatabase(connectionId, database)
    const collections = await db.listCollections().toArray()
    return {
      success: true,
      tables: collections.map(c => c.name)
    }
  }
}
```

### 4. UI Adaptations

#### A. Query Editor Enhancement
- Add query type selector (SQL/Redis/MongoDB)
- Implement syntax highlighting for Redis commands and MongoDB queries
- Add command palette with auto-completion for Redis/MongoDB

#### B. Results Display
- Enhance TableView to support multiple display modes:
  - **Table Mode**: Current grid view (default for SQL)
  - **Key-Value Mode**: Two-column view for Redis
  - **Document Mode**: Tree view for MongoDB with expand/collapse
  - **Raw Mode**: JSON/Text view

#### C. Database Explorer
- Adapt icons and structure for different database types
- For Redis: Show key types (string, list, set, hash, etc.)
- For MongoDB: Show collection statistics and indexes

#### D. New Components Needed

```typescript
// KeyValueView.tsx - For Redis data display
interface KeyValueViewProps {
  data: Array<{ key: string; value: any; type: string; ttl?: number }>
  onEdit?: (key: string, value: any) => void
  onDelete?: (keys: string[]) => void
}

// DocumentView.tsx - For MongoDB document display
interface DocumentViewProps {
  documents: any[]
  onEdit?: (id: string, updates: any) => void
  onDelete?: (ids: string[]) => void
  viewMode: 'tree' | 'table' | 'json'
}
```

### 5. Connection Dialog Updates
- Add Redis-specific options:
  - Database number (0-15)
  - Connection timeout
  - Cluster mode checkbox
- Add MongoDB-specific options:
  - Connection string override
  - Replica set name
  - Auth mechanism

## Implementation Roadmap

### Phase 1: Foundation (1 week)
1. Update interfaces and base classes
2. Add database type detection
3. Create plugin architecture for query languages

### Phase 2: Redis Support (2 weeks)
1. Implement RedisManager
2. Create KeyValueView component
3. Add Redis command highlighting
4. Implement key pattern browsing

### Phase 3: MongoDB Support (3 weeks)
1. Implement MongoDBManager
2. Create DocumentView component
3. Add MongoDB query builder
4. Implement collection browsing

### Phase 4: UI Polish (1 week)
1. Unified result viewer with format detection
2. Enhanced connection management
3. Performance optimizations
4. Testing and bug fixes

## Technical Considerations

### Performance
- Implement pagination for large datasets
- Use virtual scrolling for document lists
- Cache frequently accessed keys/documents
- Implement lazy loading for nested documents

### Security
- Secure credential storage (already implemented)
- SSL/TLS support for both Redis and MongoDB
- Connection string validation
- Sanitize user inputs for native queries

### User Experience
- Auto-detect data format and suggest best view
- Provide query templates and examples
- Support import/export in native formats
- Add query history for each database type

## Alternative Approaches Considered

1. **Separate Apps**: Build dedicated Redis/MongoDB clients - Rejected for code duplication
2. **SQL Translation**: Convert all operations to SQL - Rejected as too limiting
3. **Plugin System**: Make database support fully pluggable - Considered for future version

## Conclusion

Implementing Redis and MongoDB support in DataPup is feasible with the proposed design. The modular architecture allows for clean integration while the UI adaptations ensure a native experience for each database type. Redis can be implemented quickly due to its simpler data model, while MongoDB will require more extensive UI work but will provide significant value to users.

## Next Steps

1. Review and approve this design proposal
2. Create feature branch for Redis implementation
3. Implement base class modifications
4. Begin Phase 1 development

---

*Prepared for DataPup Development Team*
*Date: 2025-01-09*