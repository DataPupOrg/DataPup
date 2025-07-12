import { useState, useRef } from 'react'
import { Button, Flex, Text, Card, Box } from '@radix-ui/themes'
import Editor, { Monaco } from '@monaco-editor/react'
import { Skeleton } from '../ui'
import { useTheme } from '../../hooks/useTheme'
import './QueryEditor.css'
import { v4 as uuidv4 } from 'uuid'

interface QueryEditorProps {
  connectionId: string
  connectionName: string
}

interface QueryResult {
  success: boolean
  data?: any[]
  message: string
  error?: string
}

// SQL keywords for autocomplete
const sqlKeywords = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'ON',
  'GROUP',
  'BY',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'ALTER',
  'DROP',
  'INDEX',
  'VIEW',
  'PROCEDURE',
  'FUNCTION',
  'TRIGGER',
  'AS',
  'DISTINCT',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'ASC',
  'DESC',
  'UNION',
  'ALL',
  'ANY',
  'SOME'
]

export function QueryEditor({ connectionId, connectionName }: QueryEditorProps) {
  const { theme } = useTheme()
  const [query, setQuery] = useState('SELECT * FROM users LIMIT 10')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const editorRef = useRef<any>(null)

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor

    // Configure SQL language settings
    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position) => {
        const suggestions = sqlKeywords.map((keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          documentation: `SQL keyword: ${keyword}`
        }))
        return { suggestions }
      }
    })

    // Add keyboard shortcuts
    editor.addAction({
      id: 'execute-query',
      label: 'Execute Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => handleExecuteQuery()
    })

    // Track selected text
    editor.onDidChangeCursorSelection((e: any) => {
      const selection = editor.getSelection()
      const text = editor.getModel().getValueInRange(selection)
      setSelectedText(text)
    })
  }

  const handleExecuteQuery = async () => {
    const queryToExecute = selectedText || query
    if (!queryToExecute.trim()) return

    try {
      setIsExecuting(true)
      setResult(null)

      const sessionId = uuidv4()
      const queryResult = await window.api.database.query(
        connectionId,
        queryToExecute.trim(),
        sessionId
      )
      setResult(queryResult)
    } catch (error) {
      console.error('Query execution error:', error)
      setResult({
        success: false,
        message: 'Query execution failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setIsExecuting(false)
    }
  }

  const formatQuery = () => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument').run()
    }
  }

  return (
    <div className="query-editor">
      <Flex direction="column" gap="4" height="100%">
        {/* Header */}
        <Flex justify="between" align="center" px="4" pt="4">
          <Flex align="center" gap="3">
            <Text size="3" weight="bold">
              Query Editor
            </Text>
            <Text size="2" color="gray">
              {connectionName}
            </Text>
          </Flex>
          <Flex gap="2" align="center">
            <Text size="1" color="gray">
              {selectedText ? 'Execute selected' : 'Cmd/Ctrl + Enter to execute'}
            </Text>
            <Button size="1" variant="soft" onClick={formatQuery}>
              Format
            </Button>
            <Button
              onClick={handleExecuteQuery}
              disabled={isExecuting || (!query.trim() && !selectedText.trim())}
              size="2"
            >
              {isExecuting ? 'Executing...' : 'Execute'}
            </Button>
          </Flex>
        </Flex>

        {/* SQL Editor */}
        <Box className="editor-container">
          <Editor
            height="300px"
            defaultLanguage="sql"
            theme={theme.appearance === 'dark' ? 'vs-dark' : 'vs'}
            value={query}
            onChange={(value) => setQuery(value || '')}
            onMount={handleEditorDidMount}
            loading={<Skeleton height={300} />}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              formatOnPaste: true,
              formatOnType: true,
              automaticLayout: true,
              suggestOnTriggerCharacters: true,
              quickSuggestions: {
                other: true,
                comments: false,
                strings: false
              },
              parameterHints: {
                enabled: true
              }
            }}
          />
        </Box>

        {/* Results */}
        {result && (
          <Card className="query-result-card">
            <Flex justify="between" align="center" mb="3">
              <Text size="2" weight="bold">
                Results
              </Text>
              {result.success && result.data && (
                <Text size="1" color="gray">
                  {result.data.length} rows returned
                </Text>
              )}
            </Flex>

            {result.success ? (
              <Box className="result-content">
                {result.data && result.data.length > 0 ? (
                  <QueryResults data={result.data} />
                ) : (
                  <Flex align="center" justify="center" py="8">
                    <Text color="gray">No data returned</Text>
                  </Flex>
                )}
              </Box>
            ) : (
              <Box className="error-message" p="3">
                <Text color="red" weight="bold" size="2">
                  Error
                </Text>
                <Text color="red" size="1" mt="1">
                  {result.error || result.message}
                </Text>
              </Box>
            )}
          </Card>
        )}
      </Flex>
    </div>
  )
}

function QueryResults({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null

  const columns = Object.keys(data[0])

  return (
    <Box className="query-results-table">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>
                  {row[column] !== null && row[column] !== undefined ? (
                    String(row[column])
                  ) : (
                    <span className="null-value">NULL</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  )
}
