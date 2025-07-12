import { useState, useEffect } from 'react'
import { Button, Input, Label, Dialog, Flex, Select, Text, Card } from '../ui'
import { TextField, Checkbox } from '@radix-ui/themes'
import './DatabaseConnection.css'

interface DatabaseConnectionProps {
  onConnectionSuccess?: (connection: any) => void
  onCancel?: () => void
  inline?: boolean
}

export function DatabaseConnection({
  onConnectionSuccess,
  onCancel,
  inline = false
}: DatabaseConnectionProps) {
  const [open, setOpen] = useState(false)
  const [dbType, setDbType] = useState('clickhouse')
  const [saveConnection, setSaveConnection] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [supportedTypes] = useState<string[]>(['clickhouse'])
  const [connectionData, setConnectionData] = useState({
    label: '',
    host: 'localhost',
    port: '8123',
    database: 'default',
    username: 'default',
    password: '',
    secure: false,
    readonly: false
  })

  // Update port when secure connection is toggled
  useEffect(() => {
    if (dbType === 'clickhouse') {
      setConnectionData((prev) => ({
        ...prev,
        port: prev.secure ? '8443' : '8123'
      }))
    }
  }, [connectionData.secure, dbType])

  // Load supported database types on component mount
  useEffect(() => {
    const loadSupportedTypes = async () => {
      try {
        // TODO: Uncomment when getSupportedTypes is properly typed
        // const result = await window.api.database.getSupportedTypes()
        // if (result.success) {
        //   setSupportedTypes(result.types)
        // }
      } catch (error) {
        console.error('Error loading supported database types:', error)
      }
    }
    loadSupportedTypes()
  }, [])

  const handleTestConnection = async () => {
    try {
      setIsTesting(true)
      setTestResult(null)

      const result = await window.api.database.testConnection({
        type: dbType,
        ...connectionData,
        port: parseInt(connectionData.port)
      })

      setTestResult({
        success: result.success,
        message: result.message || (result.success ? 'Connection successful!' : 'Connection failed')
      })
    } catch (error) {
      console.error('Test connection error:', error)
      setTestResult({
        success: false,
        message: 'Test connection error occurred'
      })
    } finally {
      setIsTesting(false)
    }
  }

  const handleConnect = async () => {
    try {
      setIsConnecting(true)
      const result = await window.api.database.connect({
        type: dbType,
        ...connectionData,
        port: parseInt(connectionData.port),
        saveConnection
      })

      if (result.success) {
        console.log('Connected:', result.message)
        setOpen(false)
        // Reset form
        setConnectionData({
          label: '',
          host: 'localhost',
          port: '8123',
          database: 'default',
          username: 'default',
          password: '',
          secure: false,
          readonly: false
        })
        setSaveConnection(true)
        // Notify parent component
        if (onConnectionSuccess && result.connectionId) {
          // Create a connection object for the parent component
          const connection = {
            id: result.connectionId,
            name:
              connectionData.label || `${dbType} - ${connectionData.host}:${connectionData.port}`,
            type: dbType,
            host: connectionData.host,
            port: parseInt(connectionData.port),
            database: connectionData.database,
            username: connectionData.username,
            secure: connectionData.secure,
            createdAt: new Date().toISOString()
          }
          // Only call onConnectionSuccess if the connection should be saved
          if (saveConnection) {
            onConnectionSuccess(connection)
          }
        }
      } else {
        console.error('Connection failed:', result.message)
        alert(`Connection failed: ${result.message}`)
      }
    } catch (error) {
      console.error('Connection error:', error)
      alert('Connection error occurred')
    } finally {
      setIsConnecting(false)
    }
  }

  const getDefaultPort = (type: string) => {
    switch (type) {
      case 'clickhouse':
        return '8123'
      case 'postgresql':
        return '5432'
      case 'mysql':
        return '3306'
      case 'sqlite':
        return ''
      default:
        return '5432'
    }
  }

  const handleDbTypeChange = (type: string) => {
    setDbType(type)
    setConnectionData((prev) => ({
      ...prev,
      port: getDefaultPort(type)
    }))
  }

  const handleCancel = () => {
    if (inline && onCancel) {
      onCancel()
    } else {
      setOpen(false)
    }
  }

  // Inline form mode
  if (inline) {
    return (
      <Card style={{ padding: '24px' }}>
        <Flex direction="column" gap="4">
          <Text size="4" weight="medium">
            Connect to Database
          </Text>

          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Label htmlFor="label">Label</Label>
              <TextField.Root
                id="label"
                value={connectionData.label}
                onChange={(e) => setConnectionData({ ...connectionData, label: e.target.value })}
                placeholder="My Database Connection"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="db-type">Database Type</Label>
              <Select.Root value={dbType} onValueChange={setDbType}>
                <Select.Trigger id="db-type" className="full-width" />
                <Select.Content>
                  {supportedTypes.map((type) => (
                    <Select.Item key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="host">Host</Label>
              <TextField.Root
                id="host"
                value={connectionData.host}
                onChange={(e) => setConnectionData({ ...connectionData, host: e.target.value })}
                placeholder="localhost"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="port">Port</Label>
              <TextField.Root
                id="port"
                value={connectionData.port}
                onChange={(e) => setConnectionData({ ...connectionData, port: e.target.value })}
                placeholder="5432"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="database">Database</Label>
              <TextField.Root
                id="database"
                value={connectionData.database}
                onChange={(e) => setConnectionData({ ...connectionData, database: e.target.value })}
                placeholder="my_database"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="username">Username</Label>
              <TextField.Root
                id="username"
                value={connectionData.username}
                onChange={(e) => setConnectionData({ ...connectionData, username: e.target.value })}
                placeholder="username"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="password">Password</Label>
              <TextField.Root
                id="password"
                type="password"
                value={connectionData.password}
                onChange={(e) => setConnectionData({ ...connectionData, password: e.target.value })}
                placeholder="password"
              />
            </Flex>

            {dbType === 'clickhouse' && (
              <Flex align="center" gap="2">
                <Checkbox
                  id="secure-connection"
                  checked={connectionData.secure}
                  onCheckedChange={(checked) =>
                    setConnectionData({ ...connectionData, secure: checked as boolean })
                  }
                />
                <Label htmlFor="secure-connection" size="2">
                  Use secure connection (HTTPS)
                </Label>
              </Flex>
            )}
          </Flex>

          <Flex direction="column" gap="3">
            <Flex align="center" gap="2">
              <Checkbox
                id="readonly-connection"
                checked={connectionData.readonly}
                onCheckedChange={(checked) =>
                  setConnectionData({ ...connectionData, readonly: checked as boolean })
                }
              />
              <Label htmlFor="readonly-connection" size="2">
                Read-only connection (only SELECT queries allowed)
              </Label>
            </Flex>

            <Flex align="center" gap="2">
              <Checkbox
                id="save-connection"
                checked={saveConnection}
                onCheckedChange={(checked) => setSaveConnection(checked as boolean)}
              />
              <Label htmlFor="save-connection" size="2">
                Save this connection for future use
              </Label>
            </Flex>
          </Flex>

          {testResult && (
            <Text size="2" color={testResult.success ? 'green' : 'red'}>
              {testResult.message}
            </Text>
          )}

          <Flex gap="3" justify="end">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={isConnecting || isTesting}
            >
              {isTesting ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button
              variant="soft"
              color="gray"
              onClick={handleCancel}
              disabled={isConnecting || isTesting}
            >
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={isConnecting || isTesting}>
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          </Flex>
        </Flex>
      </Card>
    )
  }

  // Dialog mode (original behavior)
  return (
    <>
      <Button size="1" onClick={() => setOpen(true)}>
        Connect to Database
      </Button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>Connect to Database</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            Enter your database connection details
          </Dialog.Description>

          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Label htmlFor="label">Label</Label>
              <TextField.Root
                id="label"
                value={connectionData.label}
                onChange={(e) => setConnectionData({ ...connectionData, label: e.target.value })}
                placeholder="My Database Connection"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="db-type">Database Type</Label>
              <Select.Root value={dbType} onValueChange={setDbType}>
                <Select.Trigger id="db-type" className="full-width" />
                <Select.Content>
                  {supportedTypes.map((type) => (
                    <Select.Item key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="host">Host</Label>
              <TextField.Root
                id="host"
                value={connectionData.host}
                onChange={(e) => setConnectionData({ ...connectionData, host: e.target.value })}
                placeholder="localhost"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="port">Port</Label>
              <TextField.Root
                id="port"
                value={connectionData.port}
                onChange={(e) => setConnectionData({ ...connectionData, port: e.target.value })}
                placeholder="5432"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="database">Database</Label>
              <TextField.Root
                id="database"
                value={connectionData.database}
                onChange={(e) => setConnectionData({ ...connectionData, database: e.target.value })}
                placeholder="my_database"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="username">Username</Label>
              <TextField.Root
                id="username"
                value={connectionData.username}
                onChange={(e) => setConnectionData({ ...connectionData, username: e.target.value })}
                placeholder="username"
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Label htmlFor="password">Password</Label>
              <TextField.Root
                id="password"
                type="password"
                value={connectionData.password}
                onChange={(e) => setConnectionData({ ...connectionData, password: e.target.value })}
                placeholder="password"
              />
            </Flex>

            {dbType === 'clickhouse' && (
              <Flex align="center" gap="2">
                <Checkbox
                  id="secure-connection-dialog"
                  checked={connectionData.secure}
                  onCheckedChange={(checked) =>
                    setConnectionData({ ...connectionData, secure: checked as boolean })
                  }
                />
                <Label htmlFor="secure-connection-dialog" size="2">
                  Use secure connection (HTTPS)
                </Label>
              </Flex>
            )}
          </Flex>

          <Flex direction="column" gap="3" mt="4">
            <Flex align="center" gap="2">
              <Checkbox
                id="readonly-connection-dialog"
                checked={connectionData.readonly}
                onCheckedChange={(checked) =>
                  setConnectionData({ ...connectionData, readonly: checked as boolean })
                }
              />
              <Label htmlFor="readonly-connection-dialog" size="2">
                Read-only connection (only SELECT queries allowed)
              </Label>
            </Flex>

            <Flex align="center" gap="2">
              <Checkbox
                id="save-connection-dialog"
                checked={saveConnection}
                onCheckedChange={(checked) => setSaveConnection(checked as boolean)}
              />
              <Label htmlFor="save-connection-dialog" size="2">
                Save this connection for future use
              </Label>
            </Flex>
          </Flex>

          {testResult && (
            <Text size="2" color={testResult.success ? 'green' : 'red'} mt="2">
              {testResult.message}
            </Text>
          )}

          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={isConnecting || isTesting}
            >
              {isTesting ? 'Testing...' : 'Test Connection'}
            </Button>
            <Dialog.Close>
              <Button variant="soft" color="gray" disabled={isConnecting || isTesting}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={handleConnect} disabled={isConnecting || isTesting}>
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  )
}
