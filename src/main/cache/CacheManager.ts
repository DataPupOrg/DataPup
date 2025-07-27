import { QueryCache } from './QueryCache'
import { QueryNormalizer } from './QueryNormalizer'
import { QueryResult } from '../database/interface'
import { CacheConfig, CacheStats, CacheMetadata, DEFAULT_CACHE_CONFIG } from './types'

export class CacheManager {
  private static instance: CacheManager | null = null
  private queryCache: QueryCache
  private config: CacheConfig
  private enabled: boolean = true

  private constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config }
    this.queryCache = new QueryCache(this.config)
  }

  static getInstance(config?: Partial<CacheConfig>): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager(config)
    }
    return CacheManager.instance
  }

  /**
   * Get cached query result
   */
  async getCachedResult(
    query: string,
    connectionId: string,
    database?: string
  ): Promise<QueryResult | null> {
    if (!this.enabled || !QueryNormalizer.shouldCache(query)) {
      return null
    }

    const cacheKey = QueryNormalizer.generateCacheKey(query, connectionId, database)
    return await this.queryCache.get(cacheKey)
  }

  /**
   * Cache query result
   */
  async cacheResult(
    query: string,
    result: QueryResult,
    connectionId: string,
    database?: string
  ): Promise<void> {
    if (!this.enabled || !QueryNormalizer.shouldCache(query)) {
      return
    }

    // Don't cache failed queries
    if (!result.success) {
      return
    }

    const normalizedQuery = QueryNormalizer.normalize(query)
    const cacheKey = QueryNormalizer.generateCacheKey(query, connectionId, database)

    const metadata: CacheMetadata = {
      connectionId,
      originalQuery: query,
      queryHash: normalizedQuery.hash,
      hitCount: 0,
      lastAccessed: Date.now(),
      tables: normalizedQuery.tables,
      queryType: normalizedQuery.queryType
    }

    await this.queryCache.set(cacheKey, result, metadata)
  }

  /**
   * Invalidate cache entries by table name
   */
  invalidateTable(tableName: string): number {
    console.log(`Invalidating cache for table: ${tableName}`)
    return this.queryCache.invalidateByTable(tableName)
  }

  /**
   * Invalidate cache entries by connection
   */
  invalidateConnection(connectionId: string): number {
    console.log(`Invalidating cache for connection: ${connectionId}`)
    return this.queryCache.invalidateByConnection(connectionId)
  }

  /**
   * Invalidate cache based on query type
   */
  invalidateByQueryType(query: string, connectionId: string, _database?: string): void {
    const normalizedQuery = QueryNormalizer.normalize(query)

    switch (normalizedQuery.queryType) {
      case 'DDL':
        // DDL operations might affect schema, invalidate all for this connection
        this.invalidateConnection(connectionId)
        break

      case 'DML':
        // DML operations affect specific tables
        normalizedQuery.tables.forEach((table) => {
          this.invalidateTable(table)
        })
        break

      default:
        // No invalidation needed for SELECT queries
        break
    }
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    console.log('Clearing all cache entries')
    this.queryCache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return this.queryCache.getStats()
  }

  /**
   * Get cache configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config }
  }

  /**
   * Update cache configuration
   */
  updateConfig(newConfig: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...newConfig }
    this.queryCache.updateConfig(this.config)
  }

  /**
   * Enable or disable caching
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.clearAll()
    }
    console.log(`Query caching ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * Check if caching is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get cache entry details for debugging
   */
  getCacheEntryInfo(query: string, connectionId: string, database?: string): any {
    const cacheKey = QueryNormalizer.generateCacheKey(query, connectionId, database)
    const normalizedQuery = QueryNormalizer.normalize(query)

    return {
      cacheKey,
      normalizedQuery,
      shouldCache: QueryNormalizer.shouldCache(query),
      isEnabled: this.enabled
    }
  }

  /**
   * Dispose of cache manager and clean up resources
   */
  dispose(): void {
    this.queryCache.dispose()
    CacheManager.instance = null
  }

  /**
   * Export cache statistics for monitoring
   */
  exportMetrics(): any {
    const stats = this.getStats()
    const config = this.getConfig()

    return {
      timestamp: new Date().toISOString(),
      enabled: this.enabled,
      stats,
      config: {
        maxSize: config.maxSize,
        maxMemory: config.maxMemory,
        defaultTTL: config.defaultTTL,
        compressionThreshold: config.compressionThreshold,
        enableCompression: config.enableCompression
      },
      memoryUsage: {
        used: stats.totalMemory,
        limit: config.maxMemory,
        utilization: stats.totalMemory / config.maxMemory
      },
      performance: {
        hitRatio: stats.hitRatio,
        totalQueries: stats.hits + stats.misses,
        cacheEfficiency: stats.hits > 0 ? stats.hits / (stats.hits + stats.misses) : 0
      }
    }
  }
}
