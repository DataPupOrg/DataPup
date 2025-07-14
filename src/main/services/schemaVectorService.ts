import { DatabaseSchema, TableSchema, ColumnSchema } from '../llm/interface'
import axios from 'axios'

interface QueryAnalysis {
  entities: string[]
  actions: string[]
  queryType: 'select' | 'count' | 'aggregate' | 'join' | 'filter'
  timeContext?: string
  intent: string
}

interface SchemaRelevance {
  table: string
  relevance: number
  columns: ColumnRelevance[]
  semanticScore: number
}

interface ColumnRelevance {
  name: string
  relevance: number
  semanticScore: number
  reason: string
}

interface PrunedSchema {
  schema: DatabaseSchema
  sampleData: Record<string, any[]>
  relevanceScores: SchemaRelevance[]
  analysis: QueryAnalysis
}

export class SchemaVectorService {
  private readonly embeddingServiceUrl = 'http://localhost:5001'
  private isServiceAvailable = false

  constructor() {
    this.checkServiceHealth()
  }

  /**
   * Check if the Python embedding service is available
   */
  private async checkServiceHealth(): Promise<void> {
    try {
      const response = await axios.get(`${this.embeddingServiceUrl}/health`, {
        timeout: 5000
      })
      this.isServiceAvailable = response.status === 200
      console.log('✅ Python embedding service is available')
    } catch (error) {
      console.warn('⚠️ Python embedding service not available, using fallback methods')
      this.isServiceAvailable = false
    }
  }

  /**
   * Get relevant schema components for a given query using advanced NLP
   * This version uses a hybrid "Top-K" and "Threshold" selection method
   * for more efficient and accurate pruning.
   */
  async getRelevantSchema(
    query: string,
    fullSchema: DatabaseSchema,
    sampleData: Record<string, any[]> = {},
    topK: number = 5, // Consider the top 5 most relevant elements...
    similarityThreshold: number = 0.25 // ...but only if their score is above this threshold.
  ): Promise<PrunedSchema> {
    console.log('🔍 Analyzing query with Python NLP service:', query)

    const analysis = await this.analyzeQuery(query)
    const relevanceScores = await this.calculateSemanticRelevance(query, fullSchema, analysis)

    // 1. Sort by relevance descending
    const sortedScores = [...relevanceScores].sort((a, b) => b.relevance - a.relevance)

    // 2. Take the Top K most relevant tables
    const topKScores = sortedScores.slice(0, topK)

    // 3. Apply the quality threshold to the Top-K list
    const relevantScores = topKScores.filter((score) => score.relevance >= similarityThreshold)

    // 4. Map to actual TableSchema objects
    const relevantTables = relevantScores
      .map((score) => fullSchema.tables.find((t) => t.name === score.table))
      .filter((t): t is TableSchema => !!t)

    // Create pruned schema
    const prunedSchema: DatabaseSchema = {
      database: fullSchema.database,
      tables: relevantTables
    }

    // Filter sample data to only include relevant tables
    const prunedSampleData: Record<string, any[]> = {}
    for (const tableName of relevantTables.map((t) => t.name)) {
      if (sampleData[tableName]) {
        prunedSampleData[tableName] = sampleData[tableName]
      }
    }

    console.log(`📊 Python-powered schema pruning results:`, {
      originalTables: fullSchema.tables.length,
      prunedTables: relevantTables.length,
      tables: relevantTables.map((t) => t.name),
      analysis: {
        entities: analysis.entities,
        intent: analysis.intent,
        queryType: analysis.queryType
      },
      relevanceScores: relevantScores.map((r) => ({
        table: r.table,
        score: r.relevance.toFixed(3),
        semanticScore: r.semanticScore.toFixed(3)
      })),
      pruningConfig: {
        topK,
        similarityThreshold,
        topKScores: topKScores.length,
        thresholdFiltered: relevantScores.length
      }
    })

    return {
      schema: prunedSchema,
      sampleData: prunedSampleData,
      relevanceScores: relevantScores,
      analysis
    }
  }

  /**
   * Advanced query analysis using Python NLP service
   */
  private async analyzeQuery(query: string): Promise<QueryAnalysis> {
    const lowerQuery = query.toLowerCase()

    // Extract entities using keyword patterns (can be enhanced with Python NLP)
    const entities = this.extractEntities(query)

    // Extract actions using keyword patterns
    const actions = this.extractActions(lowerQuery)

    // Determine query type using semantic analysis
    const queryType = await this.classifyQueryType(query)

    // Extract time context
    const timeContext = this.extractTimeContext(lowerQuery)

    // Generate intent using semantic analysis
    const intent = await this.extractIntent(query)

    return {
      entities,
      actions,
      queryType,
      timeContext,
      intent
    }
  }

  /**
   * Extract entities using keyword patterns
   */
  private extractEntities(query: string): string[] {
    const entities: string[] = []
    const lowerQuery = query.toLowerCase()

    // Database-specific entity patterns
    const entityPatterns = [
      { pattern: /\b(users?|user)\b/g, entity: 'user' },
      { pattern: /\b(posts?|post)\b/g, entity: 'post' },
      { pattern: /\b(comments?|comment)\b/g, entity: 'comment' },
      { pattern: /\b(votes?|vote)\b/g, entity: 'vote' },
      { pattern: /\b(tags?|tag)\b/g, entity: 'tag' },
      { pattern: /\b(authors?|author)\b/g, entity: 'user' },
      { pattern: /\b(creators?|creator)\b/g, entity: 'user' },
      { pattern: /\b(owners?|owner)\b/g, entity: 'user' },
      { pattern: /\b(questions?|question)\b/g, entity: 'post' },
      { pattern: /\b(answers?|answer)\b/g, entity: 'post' }
    ]

    for (const { pattern, entity } of entityPatterns) {
      if (pattern.test(lowerQuery)) {
        entities.push(entity)
      }
    }

    return [...new Set(entities)]
  }

  /**
   * Extract actions from query
   */
  private extractActions(query: string): string[] {
    const actions: string[] = []
    const actionKeywords = [
      'find',
      'show',
      'get',
      'count',
      'sum',
      'average',
      'select',
      'list',
      'display',
      'how many',
      'what is',
      'which',
      'where',
      'when',
      'who'
    ]

    for (const action of actionKeywords) {
      if (query.includes(action)) {
        actions.push(action)
      }
    }

    return actions
  }

  /**
   * Classify query type using semantic analysis
   */
  private async classifyQueryType(query: string): Promise<QueryAnalysis['queryType']> {
    const lowerQuery = query.toLowerCase()

    // Simple keyword-based classification
    if (lowerQuery.includes('count') || lowerQuery.includes('how many')) {
      return 'count'
    } else if (
      lowerQuery.includes('sum') ||
      lowerQuery.includes('average') ||
      lowerQuery.includes('total')
    ) {
      return 'aggregate'
    } else if (
      lowerQuery.includes('join') ||
      lowerQuery.includes('with') ||
      lowerQuery.includes('and')
    ) {
      return 'join'
    } else if (lowerQuery.includes('where') || lowerQuery.includes('filter')) {
      return 'filter'
    }

    return 'select'
  }

  /**
   * Extract time context from query
   */
  private extractTimeContext(query: string): string | undefined {
    const timeKeywords = [
      'recent',
      'latest',
      'today',
      'yesterday',
      'last week',
      'last month',
      'this year',
      'last year',
      'recently',
      'new',
      'old'
    ]

    return timeKeywords.find((keyword) => query.includes(keyword))
  }

  /**
   * Extract intent using semantic analysis
   */
  private async extractIntent(query: string): Promise<string> {
    const lowerQuery = query.toLowerCase()

    // Simple intent classification
    if (
      lowerQuery.includes('most') ||
      lowerQuery.includes('highest') ||
      lowerQuery.includes('top')
    ) {
      return 'find_maximum'
    } else if (lowerQuery.includes('count') || lowerQuery.includes('how many')) {
      return 'count_entities'
    } else if (lowerQuery.includes('average') || lowerQuery.includes('mean')) {
      return 'calculate_average'
    } else if (lowerQuery.includes('recent') || lowerQuery.includes('latest')) {
      return 'find_recent'
    }

    return 'find_information'
  }

  /**
   * Calculate semantic relevance using Python embedding service
   */
  private async calculateSemanticRelevance(
    query: string,
    schema: DatabaseSchema,
    analysis: QueryAnalysis
  ): Promise<SchemaRelevance[]> {
    const relevanceScores: SchemaRelevance[] = []

    for (const table of schema.tables) {
      // Calculate semantic similarity using Python service
      const semanticScore = await this.calculateSemanticSimilarity(query, table)

      // Calculate keyword-based relevance
      const keywordScore = this.calculateKeywordRelevance(query, table, analysis)

      // Combine scores
      const combinedScore = semanticScore * 0.7 + keywordScore * 0.3

      // Calculate column relevance
      const columns = await Promise.all(
        table.columns.map(async (col) => ({
          name: col.name,
          relevance: this.calculateColumnRelevance(query, col, analysis),
          semanticScore: await this.calculateColumnSemanticSimilarity(query, col),
          reason: this.getColumnRelevanceReason(query, col, analysis)
        }))
      )

      relevanceScores.push({
        table: table.name,
        relevance: Math.min(combinedScore, 1.0),
        semanticScore,
        columns
      })
    }

    return relevanceScores.sort((a, b) => b.relevance - a.relevance)
  }

  /**
   * Calculate semantic similarity between query and table using Python service
   */
  private async calculateSemanticSimilarity(query: string, table: TableSchema): Promise<number> {
    if (!this.isServiceAvailable) {
      return this.calculateSimilarityFallback(query, table)
    }

    try {
      // Create table description
      const tableText = `${table.name} ${table.columns.map((col) => col.name).join(' ')}`

      // Use Python service to calculate similarity
      const response = await axios.post(`${this.embeddingServiceUrl}/similarity`, {
        text1: query,
        text2: tableText
      })

      return response.data.similarity
    } catch (error) {
      console.warn('Python similarity service failed, using fallback:', error)
      return this.calculateSimilarityFallback(query, table)
    }
  }

  /**
   * Calculate semantic similarity for a column using Python service
   */
  private async calculateColumnSemanticSimilarity(
    query: string,
    column: ColumnSchema
  ): Promise<number> {
    if (!this.isServiceAvailable) {
      return 0
    }

    try {
      const response = await axios.post(`${this.embeddingServiceUrl}/similarity`, {
        text1: query,
        text2: column.name
      })

      return response.data.similarity
    } catch (error) {
      return 0
    }
  }

  /**
   * Fallback similarity calculation using TF-IDF
   */
  private calculateSimilarityFallback(query: string, table: TableSchema): number {
    const queryTerms = this.tokenize(query.toLowerCase())
    const tableText = this.getTableText(table)
    const tableTerms = this.tokenize(tableText)

    return this.calculateTFIDFSimilarity(queryTerms, tableTerms)
  }

  /**
   * Calculate keyword-based relevance
   */
  private calculateKeywordRelevance(
    query: string,
    table: TableSchema,
    analysis: QueryAnalysis
  ): number {
    const queryTerms = this.tokenize(query.toLowerCase())
    const tableText = this.getTableText(table)
    const tableTerms = this.tokenize(tableText)

    let score = 0

    // Direct matches
    for (const entity of analysis.entities) {
      if (
        table.name.toLowerCase().includes(entity) ||
        table.columns.some((col) => col.name.toLowerCase().includes(entity))
      ) {
        score += 0.4
      }
    }

    // TF-IDF similarity
    score += this.calculateTFIDFSimilarity(queryTerms, tableTerms) * 0.3

    return Math.min(score, 1.0)
  }

  /**
   * Calculate column relevance
   */
  private calculateColumnRelevance(
    query: string,
    column: ColumnSchema,
    analysis: QueryAnalysis
  ): number {
    const queryTerms = this.tokenize(query.toLowerCase())
    const columnText = column.name.toLowerCase()

    let relevance = 0

    // Direct name matches
    if (queryTerms.some((term) => columnText.includes(term))) {
      relevance += 0.5
    }

    // Entity-based relevance
    for (const entity of analysis.entities) {
      if (columnText.includes(entity)) {
        relevance += 0.4
      }
    }

    // Query type specific relevance
    if (analysis.queryType === 'count' && column.name.toLowerCase().includes('id')) {
      relevance += 0.3
    }

    if (
      analysis.queryType === 'aggregate' &&
      (column.name.toLowerCase().includes('count') ||
        column.name.toLowerCase().includes('score') ||
        column.name.toLowerCase().includes('amount'))
    ) {
      relevance += 0.3
    }

    return Math.min(relevance, 1.0)
  }

  /**
   * Get human-readable reason for column relevance
   */
  private getColumnRelevanceReason(
    query: string,
    column: ColumnSchema,
    analysis: QueryAnalysis
  ): string {
    const reasons: string[] = []

    if (query.toLowerCase().includes(column.name.toLowerCase())) {
      reasons.push('direct mention')
    }

    for (const entity of analysis.entities) {
      if (column.name.toLowerCase().includes(entity)) {
        reasons.push(`related to ${entity}`)
      }
    }

    return reasons.join(', ') || 'low relevance'
  }

  /**
   * Filter tables based on relevance scores using hybrid Top-K + Threshold selection
   */
  private filterRelevantTables(
    relevanceScores: SchemaRelevance[],
    fullSchema: DatabaseSchema,
    topK: number = 5,
    similarityThreshold: number = 0.25
  ): TableSchema[] {
    // Sort by relevance descending
    const sorted = [...relevanceScores].sort((a, b) => b.relevance - a.relevance)

    // Take the top K most relevant tables
    const topKScores = sorted.slice(0, topK)

    // Apply the quality threshold to the Top-K list
    const relevantScores = topKScores.filter((score) => score.relevance >= similarityThreshold)

    // Map to actual TableSchema objects and filter out any undefined
    return relevantScores
      .map((score) => fullSchema.tables.find((t) => t.name === score.table))
      .filter((t): t is TableSchema => !!t)
  }

  /**
   * Get comprehensive text representation of a table
   */
  private getTableText(table: TableSchema): string {
    const parts = [
      table.name,
      ...table.columns.map((col) => col.name),
      ...table.columns.map((col) => col.type)
    ]
    return parts.join(' ').toLowerCase()
  }

  /**
   * Simple tokenization
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2)
  }

  /**
   * Calculate TF-IDF similarity
   */
  private calculateTFIDFSimilarity(queryTerms: string[], tableTerms: string[]): number {
    if (queryTerms.length === 0 || tableTerms.length === 0) {
      return 0
    }

    const queryFreq = this.getTermFrequency(queryTerms)
    const tableFreq = this.getTermFrequency(tableTerms)

    const intersection = new Set([...queryTerms, ...tableTerms])
    let dotProduct = 0
    let queryNorm = 0
    let tableNorm = 0

    for (const term of intersection) {
      const queryCount = queryFreq.get(term) || 0
      const tableCount = tableFreq.get(term) || 0

      dotProduct += queryCount * tableCount
      queryNorm += queryCount * queryCount
      tableNorm += tableCount * tableCount
    }

    if (queryNorm === 0 || tableNorm === 0) {
      return 0
    }

    return dotProduct / (Math.sqrt(queryNorm) * Math.sqrt(tableNorm))
  }

  /**
   * Get term frequency map
   */
  private getTermFrequency(terms: string[]): Map<string, number> {
    const freq = new Map<string, number>()
    for (const term of terms) {
      freq.set(term, (freq.get(term) || 0) + 1)
    }
    return freq
  }
}
