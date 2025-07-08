import React from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Box, Button, Card, Flex, Text } from '@radix-ui/themes'

interface MessageRendererProps {
  content: string
  sqlQuery?: string
  onRunQuery?: (query: string) => void
  pendingStatements?: string[]
  currentStatementIndex?: number
  onExecuteNextStatement?: () => void
}

export function MessageRenderer({
  content,
  sqlQuery,
  onRunQuery,
  pendingStatements,
  currentStatementIndex,
  onExecuteNextStatement
}: MessageRendererProps) {
  return (
    <Box>
      <ReactMarkdown
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const language = match ? match[1] : ''

            if (!inline && (language === 'sql' || language === 'SQL')) {
              return (
                <Box my="2">
                  <Flex direction="column" gap="2">
                    <SyntaxHighlighter
                      language="sql"
                      style={oneDark}
                      customStyle={{
                        margin: 0,
                        borderRadius: 'var(--radius-2)',
                        fontSize: '13px'
                      }}
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                    {onRunQuery && (
                      <Button
                        size="1"
                        onClick={() => onRunQuery(String(children).replace(/\n$/, ''))}
                      >
                        ▶ Run Query
                      </Button>
                    )}
                  </Flex>
                </Box>
              )
            }

            if (!inline && language) {
              return (
                <Box my="2">
                  <SyntaxHighlighter
                    language={language}
                    style={oneDark}
                    customStyle={{
                      margin: 0,
                      borderRadius: 'var(--radius-2)',
                      fontSize: '13px'
                    }}
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </Box>
              )
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          p({ children }) {
            return (
              <Text as="p" size="2" style={{ marginBottom: '0.5em' }}>
                {children}
              </Text>
            )
          },
          ul({ children }) {
            return (
              <Box as="ul" style={{ marginLeft: '1.5em', marginBottom: '0.5em' }}>
                {children}
              </Box>
            )
          },
          ol({ children }) {
            return (
              <Box as="ol" style={{ marginLeft: '1.5em', marginBottom: '0.5em' }}>
                {children}
              </Box>
            )
          },
          li({ children }) {
            return (
              <Text as="li" size="2" style={{ marginBottom: '0.25em' }}>
                {children}
              </Text>
            )
          },
          h1({ children }) {
            return (
              <Text as="h1" size="5" weight="bold" style={{ marginBottom: '0.5em' }}>
                {children}
              </Text>
            )
          },
          h2({ children }) {
            return (
              <Text as="h2" size="4" weight="bold" style={{ marginBottom: '0.5em' }}>
                {children}
              </Text>
            )
          },
          h3({ children }) {
            return (
              <Text as="h3" size="3" weight="bold" style={{ marginBottom: '0.5em' }}>
                {children}
              </Text>
            )
          },
          blockquote({ children }) {
            return (
              <Box
                style={{
                  borderLeft: '3px solid var(--gray-6)',
                  paddingLeft: '1em',
                  marginBottom: '0.5em'
                }}
              >
                {children}
              </Box>
            )
          }
        }}
      >
        {content}
      </ReactMarkdown>

      {/* Multi-statement execution buttons */}
      {pendingStatements && currentStatementIndex !== undefined && onExecuteNextStatement && (
        <Box mt="3">
          <Card size="1">
            <Flex direction="column" gap="2">
              <Text size="1" weight="medium" color="gray">
                Statement {currentStatementIndex + 1} of {pendingStatements.length} completed
              </Text>
              {currentStatementIndex + 1 < pendingStatements.length && (
                <Button size="1" onClick={onExecuteNextStatement}>
                  ▶ Execute Next Statement
                </Button>
              )}
            </Flex>
          </Card>
        </Box>
      )}

      {/* If there's a separate SQL query (for backwards compatibility) */}
      {sqlQuery && !content.includes(sqlQuery) && (
        <Box mt="3">
          <Card size="1">
            <Flex direction="column" gap="2">
              <Text size="1" weight="medium" color="gray">
                Generated SQL:
              </Text>
              <SyntaxHighlighter
                language="sql"
                style={oneDark}
                customStyle={{
                  margin: 0,
                  borderRadius: 'var(--radius-2)',
                  fontSize: '13px'
                }}
              >
                {sqlQuery}
              </SyntaxHighlighter>
              {onRunQuery && (
                <Button size="1" onClick={() => onRunQuery(sqlQuery)}>
                  ▶ Run Query
                </Button>
              )}
            </Flex>
          </Card>
        </Box>
      )}
    </Box>
  )
}
