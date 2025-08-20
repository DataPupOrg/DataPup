import { useRef, useEffect, useState } from 'react'
import Editor, { Monaco } from '@monaco-editor/react'
import { createIntellisenseProvider } from '../../lib/intellisense'
import type { IntellisenseProvider } from '../../lib/intellisense'
import { useTheme } from '../../hooks/useTheme'

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onMount?: (editor: any, monaco: Monaco) => void
  onSelectionChange?: (selection: string) => void
  connectionId: string
  height?: string | number
  options?: any
}

export function SqlEditor({
  value,
  onChange,
  onMount,
  onSelectionChange,
  connectionId,
  height = '100%',
  options = {}
}: SqlEditorProps) {
  const { theme } = useTheme()
  const monacoRef = useRef<Monaco | null>(null)
  const editorRef = useRef<any>(null)
  const intellisenseProviderRef = useRef<IntellisenseProvider | null>(null)
  const completionDisposableRef = useRef<any>(null)
  const [databaseType, setDatabaseType] = useState<string | null>(null)
  const [monacoReady, setMonacoReady] = useState(false)

  // Fetch database type for intellisense
  useEffect(() => {
    const fetchDatabaseType = async () => {
      try {
        const response = await window.api.database.getConnectionInfo(connectionId)
        if (response.success && response.info && response.info.type) {
          setDatabaseType(response.info.type)
        } else {
          setDatabaseType('clickhouse')
        }
      } catch (error) {
        console.error('Error fetching database type:', error)
        setDatabaseType('clickhouse')
      }
    }
    fetchDatabaseType()
  }, [connectionId])

  // Cleanup intellisense on unmount
  useEffect(() => {
    return () => {
      if (completionDisposableRef.current) {
        completionDisposableRef.current.dispose()
      }
      if (intellisenseProviderRef.current) {
        intellisenseProviderRef.current.dispose()
      }
    }
  }, [])

  const initializeIntellisense = (monaco: Monaco, dbType: string) => {
    try {
      if (completionDisposableRef.current) {
        completionDisposableRef.current.dispose()
      }

      intellisenseProviderRef.current = createIntellisenseProvider(monaco, {
        connectionId,
        databaseType: dbType,
        currentDatabase: 'default'
      })

      // Register with high priority to override defaults
      completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' ', '('],
        provideCompletionItems: async (model, position) => {
          if (!intellisenseProviderRef.current) {
            return { suggestions: [] }
          }
          return await intellisenseProviderRef.current.provideCompletionItems(model, position)
        }
      })
    } catch (error) {
      console.error('Error initializing intellisense:', error)
    }
  }

  // Re-initialize intellisense when both Monaco is ready and database type is available
  useEffect(() => {
    if (monacoRef.current && monacoReady && databaseType) {
      initializeIntellisense(monacoRef.current, databaseType)
    }
  }, [monacoReady, databaseType, connectionId])

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Define light theme
    monaco.editor.defineTheme('data-pup-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '0000FF', fontStyle: 'bold' },
        { token: 'string', foreground: 'A31515' },
        { token: 'string.sql', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'operator', foreground: '000000' },
        { token: 'delimiter', foreground: '000000' },
        { token: 'identifier', foreground: '001080' },
        { token: '', foreground: '000000' }
      ],
      colors: {
        'editor.foreground': '#000000',
        'editor.background': '#00000000',
        'editor.selectionBackground': '#ADD6FF',
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#000000',
        'editorWhitespace.foreground': '#CCCCCC'
      }
    })

    // Define dark theme
    monaco.editor.defineTheme('data-pup-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'string.sql', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'comment', foreground: '608B4E', fontStyle: 'italic' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'delimiter', foreground: 'D4D4D4' },
        { token: 'identifier', foreground: '9CDCFE' },
        { token: '', foreground: 'D4D4D4' }
      ],
      colors: {
        'editor.foreground': '#D4D4D4',
        'editor.background': '#00000000',
        'editor.selectionBackground': '#264F78',
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#D4D4D4',
        'editorWhitespace.foreground': '#3B3B3B'
      }
    })

    // Apply theme
    monaco.editor.setTheme(theme.appearance === 'dark' ? 'data-pup-dark' : 'data-pup-light')

    // Don't initialize intellisense immediately - wait for database type to be fetched
    // initializeIntellisense will be called from the useEffect when databaseType changes

    // Track selection changes
    if (onSelectionChange) {
      editor.onDidChangeCursorSelection(() => {
        const selection = editor.getSelection()
        const text = editor.getModel().getValueInRange(selection)
        onSelectionChange(text)
      })
    }

    // Call parent onMount if provided
    if (onMount) {
      onMount(editor, monaco)
    }

    // Mark Monaco as ready
    setMonacoReady(true)
  }

  // Update theme when it changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      monacoRef.current.editor.setTheme(
        theme.appearance === 'dark' ? 'data-pup-dark' : 'data-pup-light'
      )
    }
  }, [theme.appearance])

  const defaultOptions = {
    minimap: { enabled: false },
    fontSize: 13,
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
    },
    suggest: {
      showKeywords: true,
      showSnippets: true,
      showClasses: true,
      showFunctions: true,
      showVariables: true,
      showModules: true,
      showProperties: true,
      showFields: true,
      showMethods: true
    },
    acceptSuggestionOnEnter: 'on',
    padding: { top: 12, bottom: 12 },
    lineNumbersMinChars: 3,
    renderLineHighlight: 'none',
    renderLineHighlightOnlyWhenFocus: false
  }

  return (
    <Editor
      height={height}
      defaultLanguage="sql"
      theme={theme.appearance === 'dark' ? 'data-pup-dark' : 'data-pup-light'}
      value={value}
      onChange={(val) => onChange(val || '')}
      onMount={handleEditorDidMount}
      options={{ ...defaultOptions, ...options }}
    />
  )
}
