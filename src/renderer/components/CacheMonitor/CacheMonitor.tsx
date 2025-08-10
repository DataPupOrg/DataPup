import React, { useState, useEffect } from 'react'
import { Box, Text, Button, Flex, Badge, Card, Switch } from '@radix-ui/themes'
import { RefreshIcon, TrashIcon } from '@radix-ui/react-icons'

interface CacheStats {
  hits: number
  misses: number
  evictions: number
  totalEntries: number
  totalMemory: number
  hitRatio: number
}

interface CacheConfig {
  maxSize: number
  maxMemory: number
  defaultTTL: number
  compressionThreshold: number
  enableCompression: boolean
  enablePersistence: boolean
}

export function CacheMonitor() {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [config, setConfig] = useState<CacheConfig | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(false)

  const fetchCacheData = async () => {
    setLoading(true)
    try {
      const [statsResult, configResult, enabledResult] = await Promise.all([
        window.api.cache.getStats(),
        window.api.cache.getConfig(),
        window.api.cache.isEnabled()
      ])

      if (statsResult.success) setStats(statsResult.stats)
      if (configResult.success) setConfig(configResult.config)
      if (enabledResult.success) setEnabled(enabledResult.enabled)
    } catch (error) {
      console.error('Failed to fetch cache data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleEnabled = async (newEnabled: boolean) => {
    try {
      const result = await window.api.cache.setEnabled(newEnabled)
      if (result.success) {
        setEnabled(newEnabled)
        await fetchCacheData() // Refresh stats
      }
    } catch (error) {
      console.error('Failed to toggle cache:', error)
    }
  }

  const handleClearCache = async () => {
    try {
      const result = await window.api.cache.clear()
      if (result.success) {
        await fetchCacheData() // Refresh stats
      }
    } catch (error) {
      console.error('Failed to clear cache:', error)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDuration = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

  useEffect(() => {
    fetchCacheData()

    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchCacheData, 5000)
    return () => clearInterval(interval)
  }, [])

  if (loading && !stats) {
    return (
      <Box p="4">
        <Text>Loading cache statistics...</Text>
      </Box>
    )
  }

  return (
    <Box p="4" style={{ minWidth: '400px' }}>
      <Flex direction="column" gap="4">
        <Flex justify="between" align="center">
          <Text size="4" weight="bold">
            Query Cache Monitor
          </Text>
          <Flex gap="2" align="center">
            <Button size="1" variant="soft" onClick={fetchCacheData} disabled={loading}>
              <RefreshIcon />
              Refresh
            </Button>
            <Button
              size="1"
              variant="soft"
              color="red"
              onClick={handleClearCache}
              disabled={!enabled}
            >
              <TrashIcon />
              Clear
            </Button>
          </Flex>
        </Flex>

        <Card>
          <Flex direction="column" gap="3" p="3">
            <Flex justify="between" align="center">
              <Text size="2" weight="medium">
                Cache Enabled
              </Text>
              <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
            </Flex>

            {stats && (
              <>
                <Flex justify="between">
                  <Text size="2">Hit Ratio</Text>
                  <Badge
                    color={stats.hitRatio > 0.5 ? 'green' : stats.hitRatio > 0.2 ? 'yellow' : 'red'}
                  >
                    {(stats.hitRatio * 100).toFixed(1)}%
                  </Badge>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Hits</Text>
                  <Text size="2" color="green">
                    {stats.hits.toLocaleString()}
                  </Text>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Misses</Text>
                  <Text size="2" color="red">
                    {stats.misses.toLocaleString()}
                  </Text>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Total Entries</Text>
                  <Text size="2">{stats.totalEntries.toLocaleString()}</Text>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Memory Usage</Text>
                  <Text size="2">{formatBytes(stats.totalMemory)}</Text>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Evictions</Text>
                  <Text size="2">{stats.evictions.toLocaleString()}</Text>
                </Flex>
              </>
            )}

            {config && (
              <>
                <Box style={{ borderTop: '1px solid var(--gray-6)', paddingTop: '12px' }}>
                  <Text size="2" weight="medium" style={{ display: 'block', marginBottom: '8px' }}>
                    Configuration
                  </Text>
                </Box>

                <Flex justify="between">
                  <Text size="2">Max Entries</Text>
                  <Text size="2">{config.maxSize.toLocaleString()}</Text>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Max Memory</Text>
                  <Text size="2">{formatBytes(config.maxMemory)}</Text>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Default TTL</Text>
                  <Text size="2">{formatDuration(config.defaultTTL)}</Text>
                </Flex>

                <Flex justify="between">
                  <Text size="2">Compression</Text>
                  <Badge color={config.enableCompression ? 'green' : 'gray'}>
                    {config.enableCompression ? 'Enabled' : 'Disabled'}
                  </Badge>
                </Flex>
              </>
            )}
          </Flex>
        </Card>

        {stats && config && (
          <Card>
            <Box p="3">
              <Text size="2" weight="medium" style={{ display: 'block', marginBottom: '8px' }}>
                Performance Insights
              </Text>

              {stats.hitRatio < 0.2 && (
                <Text size="1" color="red" style={{ display: 'block', marginBottom: '4px' }}>
                  • Low cache hit ratio - consider increasing TTL or checking query patterns
                </Text>
              )}

              {stats.evictions > stats.hits * 0.1 && (
                <Text size="1" color="yellow" style={{ display: 'block', marginBottom: '4px' }}>
                  • High eviction rate - consider increasing max size or memory limit
                </Text>
              )}

              {stats.totalMemory / config.maxMemory > 0.8 && (
                <Text size="1" color="yellow" style={{ display: 'block', marginBottom: '4px' }}>
                  • Memory usage is high - cache may start evicting entries soon
                </Text>
              )}

              {stats.hitRatio > 0.5 && stats.evictions < stats.hits * 0.05 && (
                <Text size="1" color="green" style={{ display: 'block' }}>
                  • Cache is performing well!
                </Text>
              )}
            </Box>
          </Card>
        )}
      </Flex>
    </Box>
  )
}
