export * from '../context'
export * from './clickhouse'

import { databaseContextRegistry } from '../context'
import { ClickHouseContextProvider } from './clickhouse'

// Register database context providers
databaseContextRegistry.register('clickhouse', new ClickHouseContextProvider())

// Debug logging
console.log('Database context system loaded')
console.log('Registered providers:', databaseContextRegistry.getSupportedTypes())
console.log('ClickHouse provider available:', databaseContextRegistry.hasProvider('clickhouse'))

// Test the context system
const clickhouseProvider = databaseContextRegistry.getProvider('clickhouse')
if (clickhouseProvider) {
  const instructions = clickhouseProvider.generatePromptInstructions()
  console.log('ClickHouse instructions generated successfully, length:', instructions.length)
  console.log('ClickHouse instructions include rand():', instructions.includes('rand()'))
  console.log('ClickHouse instructions include critical warnings:', instructions.includes('CRITICAL SYNTAX RULES'))
} else {
  console.error('ClickHouse provider not found!')
}

// Export the registry for use in other modules
export { databaseContextRegistry }
