import * as zlib from 'zlib'
import { promisify } from 'util'
import { QueryResult } from '../database/interface'
import { CacheEntry, CacheConfig, CacheStats, CacheMetadata, DEFAULT_CACHE_CONFIG } from './types'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

export class QueryCache {
  private cache: Map<string, CacheEntry> = new Map()
  private accessOrder: string[] = []
  private config: CacheConfig
  private stats: CacheStats
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config }
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalEntries: 0,
      totalMemory: 0,
      hitRatio: 0
    }

    // Start periodic cleanup
    this.startCleanup()
  }

  async get(key: string): Promise<QueryResult | null> {
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      this.updateHitRatio()
      return null
    }

    // Check TTL
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.delete(key)
      this.stats.misses++
      this.updateHitRatio()
      return null
    }

    // Update access order
    this.updateAccessOrder(key)
    entry.metadata.lastAccessed = Date.now()
    entry.metadata.hitCount++

    this.stats.hits++
    this.updateHitRatio()

    // Return decompressed result
    if (entry.isCompressed && entry.compressedData) {
      try {
        const decompressed = await gunzip(entry.compressedData)
        return JSON.parse(decompressed.toString())
      } catch (error) {
        console.error('Failed to decompress cache entry:', error)
        this.delete(key)
        return null
      }
    }

    // Return cloned result to prevent mutation
    return entry.result ? this.cloneResult(entry.result) : null
  }

  async set(key: string, result: QueryResult, metadata: CacheMetadata): Promise<void> {
    // Calculate size
    const size = this.estimateSize(result)

    // Check if we should compress
    const shouldCompress = this.config.enableCompression && size > this.config.compressionThreshold

    let entry: CacheEntry

    if (shouldCompress) {
      try {
        const compressed = await gzip(JSON.stringify(result))
        entry = {
          key,
          result: null,
          compressedData: compressed,
          isCompressed: true,
          timestamp: Date.now(),
          ttl: this.config.defaultTTL,
          size: compressed.length,
          metadata: { ...metadata, lastAccessed: Date.now(), hitCount: 0 }
        }
      } catch (error) {
        console.error('Failed to compress cache entry:', error)
        // Fall back to uncompressed storage
        entry = this.createUncompressedEntry(key, result, metadata, size)
      }
    } else {
      entry = this.createUncompressedEntry(key, result, metadata, size)
    }

    // Remove existing entry if it exists
    if (this.cache.has(key)) {
      this.delete(key)
    }

    // Check size constraints before adding
    await this.ensureCapacity(entry.size)

    // Add to cache
    this.cache.set(key, entry)
    this.updateAccessOrder(key)

    // Update stats
    this.stats.totalEntries = this.cache.size
    this.stats.totalMemory += entry.size
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    this.cache.delete(key)
    this.removeFromAccessOrder(key)
    this.stats.totalMemory -= entry.size
    this.stats.totalEntries = this.cache.size

    return true
  }

  clear(): void {
    this.cache.clear()
    this.accessOrder = []
    this.stats.totalEntries = 0
    this.stats.totalMemory = 0
  }

  invalidateByTable(tableName: string): number {
    let invalidated = 0

    for (const [key, entry] of this.cache.entries()) {
      if (entry.metadata.tables.includes(tableName)) {
        this.delete(key)
        invalidated++
      }
    }

    return invalidated
  }

  invalidateByConnection(connectionId: string): number {
    let invalidated = 0

    for (const [key, entry] of this.cache.entries()) {
      if (entry.metadata.connectionId === connectionId) {
        this.delete(key)
        invalidated++
      }
    }

    return invalidated
  }

  getStats(): CacheStats {
    return { ...this.stats }
  }

  getConfig(): CacheConfig {
    return { ...this.config }
  }

  updateConfig(newConfig: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  private createUncompressedEntry(
    key: string,
    result: QueryResult,
    metadata: CacheMetadata,
    size: number
  ): CacheEntry {
    return {
      key,
      result: this.cloneResult(result),
      compressedData: null,
      isCompressed: false,
      timestamp: Date.now(),
      ttl: this.config.defaultTTL,
      size,
      metadata: { ...metadata, lastAccessed: Date.now(), hitCount: 0 }
    }
  }

  private async ensureCapacity(newEntrySize: number): Promise<void> {
    // Check memory limit
    while (this.stats.totalMemory + newEntrySize > this.config.maxMemory && this.cache.size > 0) {
      await this.evictLRU()
    }

    // Check size limit
    while (this.cache.size >= this.config.maxSize && this.cache.size > 0) {
      await this.evictLRU()
    }
  }

  private async evictLRU(): Promise<void> {
    if (this.accessOrder.length === 0) return

    const lruKey = this.accessOrder[0]
    this.delete(lruKey)
    this.stats.evictions++
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key)
    this.accessOrder.push(key)
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
  }

  private estimateSize(result: QueryResult): number {
    // Base size for QueryResult metadata
    let size = 1024

    // Add size of data array
    if (result.data && Array.isArray(result.data)) {
      size += JSON.stringify(result.data).length * 2 // Account for object overhead
    }

    return size
  }

  private cloneResult(result: QueryResult): QueryResult {
    return {
      ...result,
      data: result.data ? result.data.map((row) => ({ ...row })) : undefined
    }
  }

  private updateHitRatio(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRatio = total > 0 ? this.stats.hits / total : 0
  }

  private startCleanup(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup()
      },
      5 * 60 * 1000
    )
  }

  private cleanup(): void {
    const now = Date.now()
    const expiredKeys: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        expiredKeys.push(key)
      }
    }

    for (const key of expiredKeys) {
      this.delete(key)
    }

    console.log(`Cache cleanup: removed ${expiredKeys.length} expired entries`)
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.clear()
  }
}
