export interface BaseTab {
  id: string
  title: string
  isDirty: boolean
}

export interface QueryTab extends BaseTab {
  type: 'query'
  query: string
}

export interface TableTab extends BaseTab {
  type: 'table'
  tableName: string
  database: string
  filters: TableFilter[]
}

export interface TableFilter {
  id: string
  column: string
  operator:
    | '='
    | '!='
    | '>'
    | '<'
    | '>='
    | '<='
    | 'LIKE'
    | 'IN'
    | 'NOT IN'
    | 'IS NULL'
    | 'IS NOT NULL'
  value: string
}

export type Tab = QueryTab | TableTab

export interface PaginationInfo {
  currentPage: number
  pageSize: number
  totalCount?: number
  totalPages?: number
  hasMore: boolean
  hasPrevious: boolean
}

export interface QueryExecutionResult {
  success: boolean
  data?: any[]
  message: string
  error?: string
  executionTime?: number
  rowCount?: number
  isDDL?: boolean
  isDML?: boolean
  queryType?: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'SYSTEM' | 'OTHER'
  pagination?: PaginationInfo
}
