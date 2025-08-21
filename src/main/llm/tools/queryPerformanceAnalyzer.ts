import { DatabaseManager } from '../../database/manager'
import {
  QueryPerformanceResult,
  ExecutionPlanAnalysis,
  DatabaseExplainConfig,
  QueryType
} from '../../database/interface'
import { logger } from '../../utils/logger'

export class QueryPerformanceAnalyzer {
  private databaseManager: DatabaseManager
  private explainConfigs: DatabaseExplainConfig

  constructor(databaseManager: DatabaseManager) {
    this.databaseManager = databaseManager
    this.explainConfigs = {
      postgresql: 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)',
      mysql: 'EXPLAIN FORMAT=JSON',
      clickhouse: 'EXPLAIN',
      default: 'EXPLAIN'
    }
  }

  async analyzeQueryPerformance(
    connectionId: string,
    sql: string,
    database?: string
  ): Promise<QueryPerformanceResult> {
    try {
      const databaseType = this.getDatabaseType(connectionId)
      let explainQuery = this.buildExplainQuery(sql, databaseType)

      logger.debug(`Analyzing query performance for ${databaseType}: ${explainQuery}`)

      let result = await this.databaseManager.query(connectionId, explainQuery)

      // If the database-specific EXPLAIN fails, try basic EXPLAIN as fallback
      if (!result.success && databaseType !== 'unknown') {
        logger.warn(`Database-specific EXPLAIN failed, trying basic EXPLAIN: ${result.error}`)
        explainQuery = `EXPLAIN ${sql}`
        result = await this.databaseManager.query(connectionId, explainQuery)
      }

      if (!result.success) {
        return {
          success: false,
          error: `Failed to analyze query: ${result.error}`,
          originalQuery: sql,
          attemptedQuery: explainQuery
        }
      }

      const analysis = this.parseExecutionPlan(result.data, sql, databaseType)

      return {
        success: true,
        executionPlan: result.data,
        analysis,
        originalQuery: sql,
        explainQuery,
        databaseType,
        database: database || 'default'
      }
    } catch (error) {
      logger.error('Error analyzing query performance:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        originalQuery: sql
      }
    }
  }

  private getDatabaseType(connectionId: string): string {
    const connectionInfo = this.databaseManager.getConnectionInfo(connectionId)
    if (!connectionInfo) {
      return 'unknown'
    }
    return connectionInfo.type?.toLowerCase() || 'unknown'
  }

  private buildExplainQuery(sql: string, databaseType: string): string {
    switch (databaseType) {
      case 'postgresql':
      case 'postgres':
        return `${this.explainConfigs.postgresql} ${sql}`
      case 'mysql':
        return `${this.explainConfigs.mysql} ${sql}`
      case 'clickhouse':
        return `${this.explainConfigs.clickhouse} ${sql}`
      default:
        return `${this.explainConfigs.default} ${sql}`
    }
  }

  private parseExecutionPlan(
    planData: any,
    originalQuery: string,
    databaseType: string
  ): ExecutionPlanAnalysis {
    const queryType = this.detectQueryType(originalQuery)
    const planSummary = this.formatPlanForAI(planData)

    // Extract performance metrics based on database type
    const metrics = this.extractPerformanceMetrics(planData, databaseType)

    return {
      rawPlan: planData,
      queryType,
      planSummary,
      databaseType,
      executionTimeMs: metrics.executionTimeMs,
      estimatedCost: metrics.estimatedCost,
      actualRows: metrics.actualRows,
      estimatedRows: metrics.estimatedRows,
      note: 'Raw execution plan data for AI analysis and optimization suggestions'
    }
  }

  private detectQueryType(sql: string): QueryType {
    const upperSql = sql.trim().toUpperCase()
    if (upperSql.startsWith('SELECT')) return QueryType.SELECT
    if (upperSql.startsWith('INSERT')) return QueryType.INSERT
    if (upperSql.startsWith('UPDATE')) return QueryType.UPDATE
    if (upperSql.startsWith('DELETE')) return QueryType.DELETE
    if (upperSql.startsWith('CREATE') || upperSql.startsWith('ALTER') || upperSql.startsWith('DROP')) {
      return QueryType.DDL
    }
    if (upperSql.startsWith('SHOW') || upperSql.startsWith('DESCRIBE')) {
      return QueryType.SYSTEM
    }
    return QueryType.OTHER
  }

  private formatPlanForAI(planData: any): string {
    if (typeof planData === 'string') {
      return planData
    }
    if (Array.isArray(planData)) {
      return planData.map((row) => JSON.stringify(row)).join('\n')
    }
    return JSON.stringify(planData, null, 2)
  }

  private extractPerformanceMetrics(planData: any, databaseType: string) {
    const metrics: {
      executionTimeMs?: number
      estimatedCost?: number
      actualRows?: number
      estimatedRows?: number
    } = {}

    try {
      // PostgreSQL JSON format parsing
      if (databaseType === 'postgresql' && Array.isArray(planData) && planData[0]?.Plan) {
        const plan = planData[0].Plan
        metrics.executionTimeMs = planData[0]['Execution Time']
        metrics.actualRows = plan['Actual Rows']
        metrics.estimatedRows = plan['Plan Rows']
        metrics.estimatedCost = plan['Total Cost']
      }
      
      // MySQL JSON format parsing
      else if (databaseType === 'mysql' && planData?.query_block) {
        // MySQL EXPLAIN FORMAT=JSON has different structure
        metrics.estimatedCost = planData.query_block.cost_info?.query_cost
      }
      
      // For other databases or text format, try to extract from string
      else if (typeof planData === 'string') {
        const timeMatch = planData.match(/actual time=([\d.]+)\.\.([\d.]+)/)
        if (timeMatch) {
          metrics.executionTimeMs = parseFloat(timeMatch[2])
        }
      }
    } catch (error) {
      logger.debug('Could not extract performance metrics:', error)
    }

    return metrics
  }

  // Public method for getting database-specific EXPLAIN configurations
  getExplainConfigs(): DatabaseExplainConfig {
    return { ...this.explainConfigs }
  }

  // Public method for updating EXPLAIN configurations (for extensibility)
  updateExplainConfig(databaseType: keyof DatabaseExplainConfig, config: string): void {
    this.explainConfigs[databaseType] = config
  }
}