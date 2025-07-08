import { DatabaseContextProvider, DatabaseContext } from '../context'

export class ClickHouseContextProvider extends DatabaseContextProvider {
  getContext(): DatabaseContext {
    return {
      databaseType: 'clickhouse',
      displayName: 'ClickHouse',
      description: 'A high-performance column-oriented database management system for online analytical processing (OLAP)',

      functions: {
        random: {
          integer: '',
          selection: '',
          number: ''
        },
        dateTime: {
          current: '',
          format: '',
          arithmetic: ''
        },
        aggregation: {
          count: '',
          sum: '',
          avg: '',
          groupBy: ''
        },
        string: {
          concat: '',
          substring: '',
          replace: ''
        },
        sequence: {
          generate: '',
          incremental: ''
        }
      },
      examples: {
        randomData: [],
        incrementalIds: [],
        dateTimeOperations: [],
        aggregations: [],
        joins: [],
        subqueries: []
      },
      bestPractices: [],
      dataTypes: {
        integer: [],
        string: [],
        dateTime: [],
        boolean: [],
        decimal: []
      },
      queryPatterns: {
        insert: '',
        select: '',
        update: '',
        delete: '',
        join: '',
        subquery: '',
        window: ''
      },
      features: {
        supportsTransactions: false,
        supportsForeignKeys: false,
        supportsIndexes: true,
        supportsViews: true,
        supportsStoredProcedures: false,
        supportsTriggers: false,
        supportsFullTextSearch: true
      },
      criticalSyntaxWarnings: []
    }
  }
}
