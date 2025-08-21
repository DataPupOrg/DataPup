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

  /**
   * Analyzes SQL query performance using database-specific EXPLAIN ANALYZE commands
   * @param connectionId - Database connection identifier
   * @param sql - SQL query to analyze for performance
   * @param database - Optional database name, uses connection default if not specified
   * @returns Promise resolving to query performance analysis results
   * @throws Error if database connection is invalid or query analysis fails
   */
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

  /**
   * Detects the database type from connection information
   * @param connectionId - Database connection identifier
   * @returns Database type string (postgresql, mysql, clickhouse, or unknown)
   */
  private getDatabaseType(connectionId: string): string {
    const connectionInfo = this.databaseManager.getConnectionInfo(connectionId)
    if (!connectionInfo) {
      return 'unknown'
    }
    return connectionInfo.type?.toLowerCase() || 'unknown'
  }

  /**
   * Builds database-specific EXPLAIN command with appropriate syntax and options
   * @param sql - Original SQL query to wrap with EXPLAIN
   * @param databaseType - Database type (postgresql, mysql, clickhouse, etc.)
   * @returns Complete EXPLAIN command optimized for the specific database
   */
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

  /**
   * Parses execution plan data into structured format for AI analysis
   * @param planData - Raw execution plan data from database
   * @param originalQuery - Original SQL query that was analyzed
   * @param databaseType - Database type for context-specific parsing
   * @returns Structured execution plan analysis with metrics and formatted data
   */
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

  /**
   * Detects the type of SQL query from the query string
   * @param sql - SQL query string to analyze
   * @returns QueryType enum value (SELECT, INSERT, UPDATE, DELETE, DDL, SYSTEM, or OTHER)
   */
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

  /**
   * Formats execution plan data into AI-readable string format
   * @param planData - Raw execution plan data in various formats (string, array, object)
   * @returns Formatted string representation optimized for AI analysis
   */
  private formatPlanForAI(planData: any): string {
    if (typeof planData === 'string') {
      return planData
    }
    if (Array.isArray(planData)) {
      return planData.map((row) => JSON.stringify(row)).join('\n')
    }
    return JSON.stringify(planData, null, 2)
  }

  /**
   * Extracts performance metrics from database execution plan data
   * @param planData - Raw execution plan data from database
   * @param databaseType - Database type for format-specific parsing
   * @returns Object containing execution time, costs, and row estimates
   */
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

  /**
   * Gets current database-specific EXPLAIN command configurations
   * @returns DatabaseExplainConfig object with EXPLAIN syntax for each database type
   * @example
   * const configs = analyzer.getExplainConfigs();
   * console.log(configs.postgresql); // "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)"
   */
  getExplainConfigs(): DatabaseExplainConfig {
    return { ...this.explainConfigs }
  }

  /**
   * Updates EXPLAIN command configuration for a specific database type
   * @param databaseType - Database type key (postgresql, mysql, clickhouse, default)
   * @param config - New EXPLAIN command configuration string
   * @example
   * analyzer.updateExplainConfig('postgresql', 'EXPLAIN (ANALYZE, VERBOSE, FORMAT JSON)');
   */
  updateExplainConfig(databaseType: keyof DatabaseExplainConfig, config: string): void {
    this.explainConfigs[databaseType] = config
  }
}