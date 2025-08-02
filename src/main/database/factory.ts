import { DatabaseManagerInterface } from './interface'
import { ClickHouseManager } from './clickhouse'
import { PostgreSQLManager } from './postgresql'

class DatabaseManagerFactory {
  private managers: Map<string, DatabaseManagerInterface> = new Map()

  constructor() {
    // Initialize managers for supported database types
    this.managers.set('clickhouse', new ClickHouseManager())
    this.managers.set('postgresql', new PostgreSQLManager())
  }

  getManager(databaseType: string): DatabaseManagerInterface | null {
    return this.managers.get(databaseType.toLowerCase()) || null
  }

  getSupportedTypes(): string[] {
    return Array.from(this.managers.keys())
  }

  isSupported(databaseType: string): boolean {
    return this.managers.has(databaseType.toLowerCase())
  }
}

export { DatabaseManagerFactory }
