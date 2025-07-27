import { QueryResult } from '../database/interface'

export interface CacheEntry {
  key: string
  result: QueryResult | null
  compressedData: Buffer | null
  isCompressed: boolean
  timestamp: number
  ttl: number
  size: number
  metadata: CacheMetadata
}

export interface CacheMetadata {
  connectionId: string
  originalQuery: string
  queryHash: string
  hitCount: number
  lastAccessed: number
  tables: string[]
  queryType: 'SELECT' | 'DDL' | 'DML' | 'OTHER'
}

export interface CacheConfig {
  maxSize: number // Maximum number of entries
  maxMemory: number // Maximum memory in bytes
  defaultTTL: number // Default TTL in milliseconds
  compressionThreshold: number // Size threshold for compression in bytes
  enableCompression: boolean
  enablePersistence: boolean
}

export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  totalEntries: number
  totalMemory: number
  hitRatio: number
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 1000,
  maxMemory: 100 * 1024 * 1024, // 100MB
  defaultTTL: 5 * 60 * 1000, // 5 minutes
  compressionThreshold: 1024 * 1024, // 1MB
  enableCompression: true,
  enablePersistence: false
}
