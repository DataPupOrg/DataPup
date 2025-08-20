import { Monaco } from '@monaco-editor/react'
import { IntellisenseProvider } from './IntellisenseProvider'
import { ClickHouseIntellisenseProvider } from './adapters/ClickHouseIntellisenseProvider'
import { PostgreSQLIntellisenseProvider } from './adapters/PostgreSQLIntellisenseProvider'
import { MySQLIntellisenseProvider } from './adapters/MySQLIntellisenseProvider'
import type { IntellisenseOptions } from './types'

export function createIntellisenseProvider(
  monaco: Monaco,
  options: IntellisenseOptions
): IntellisenseProvider {
  switch (options.databaseType.toLowerCase()) {
    case 'clickhouse':
      return new ClickHouseIntellisenseProvider(monaco, options)
    case 'postgresql':
      return new PostgreSQLIntellisenseProvider(monaco, options)
    case 'mysql':
      return new MySQLIntellisenseProvider(monaco, options)
    default:
      throw new Error(`Unsupported database type: ${options.databaseType}`)
  }
}

export * from './types'
export { IntellisenseProvider } from './IntellisenseProvider'
