import { useState, useEffect } from 'react'
import { MainPanel } from './components/Layout/MainPanel'
import { PageTransition } from './components/PageTransition'
import './App.css'

interface Connection {
  id: string
  name: string
  type: string
  host: string
  port: number
  database: string
  username: string
  secure?: boolean
  readonly?: boolean
  createdAt: string
  lastUsed?: string
}

function App() {
  const [activeConnection, setActiveConnection] = useState<Connection | null>(null)
  const [savedConnections, setSavedConnections] = useState<Connection[]>([])
  const [isConnectionLoading, setIsConnectionLoading] = useState(false)
  const [loadingConnectionId, setLoadingConnectionId] = useState<string | null>(null)

  // Load saved connections from secure storage on app start
  useEffect(() => {
    const loadSavedConnections = async () => {
      try {
        const result = await window.api.connections.getAll()
        if (result.success) {
          // Filter out duplicate connections based on Label (name)
          const uniqueConnections = result.connections.reduce(
            (acc: Connection[], connection: Connection) => {
              const existingConnection = acc.find((conn) => conn.name === connection.name)
              if (!existingConnection) {
                acc.push(connection)
              } else {
                // If duplicate found, keep the one with the most recent lastUsed timestamp
                const existingLastUsed = existingConnection.lastUsed
                  ? new Date(existingConnection.lastUsed).getTime()
                  : 0
                const currentLastUsed = connection.lastUsed
                  ? new Date(connection.lastUsed).getTime()
                  : 0
                if (currentLastUsed > existingLastUsed) {
                  // Replace the existing connection with the more recent one
                  const index = acc.findIndex((conn) => conn.name === connection.name)
                  acc[index] = connection
                }
              }
              return acc
            },
            []
          )

          setSavedConnections(uniqueConnections)
        }
      } catch (error) {
        console.error('Error loading saved connections:', error)
      }
    }

    loadSavedConnections()
  }, [])

  const handleConnectionSelect = async (connection: Connection) => {
    try {
      setIsConnectionLoading(true)
      setLoadingConnectionId(connection.id)

      // Retrieve the full connection details including password from secure storage
      const fullConnectionResult = await window.api.connections.getById(connection.id)

      if (!fullConnectionResult.success || !fullConnectionResult.connection) {
        console.error('Failed to retrieve connection details')
        alert('Failed to retrieve connection details. Please try creating a new connection.')
        return
      }

      const fullConnection = fullConnectionResult.connection

      console.log('Full connection retrieved from storage:', fullConnection)
      console.log('Secure flag value:', fullConnection.secure)

      // Attempt to connect to the database using the complete saved connection details
      const result = await window.api.database.connect({
        type: fullConnection.type,
        host: fullConnection.host,
        port: fullConnection.port,
        database: fullConnection.database,
        username: fullConnection.username,
        password: fullConnection.password, // Now we have the actual password
        secure: fullConnection.secure,
        readonly: connection.readonly || fullConnection.readonly, // Use the readonly flag from the connection click
        saveConnection: false // Don't save again since it's already saved
      })

      console.log('Connection attempt with config:', {
        type: fullConnection.type,
        host: fullConnection.host,
        port: fullConnection.port,
        database: fullConnection.database,
        username: fullConnection.username,
        secure: fullConnection.secure,
        readonly: connection.readonly || fullConnection.readonly
      })
      console.log('Connection result:', result)

      if (result.success) {
        console.log('Connected to saved connection:', fullConnection.name)

        // Update the connection with the new connection ID from the backend
        const updatedConnection = {
          ...fullConnection,
          id: result.connectionId || fullConnection.id
        }

        setActiveConnection(updatedConnection)

        // Update the lastUsed timestamp
        await window.api.connections.updateLastUsed(fullConnection.id)

        // Update the local saved connections list
        setSavedConnections((prev) =>
          prev.map((conn) =>
            conn.id === fullConnection.id ? { ...conn, lastUsed: new Date().toISOString() } : conn
          )
        )
      } else {
        console.error('Connection failed:', result.message)
        alert(`Connection failed: ${result.message}`)
      }
    } catch (error) {
      console.error('Connection error:', error)
      alert('Connection error occurred')
    } finally {
      setIsConnectionLoading(false) // Hide Loading Screen regardless of success/failure
      setLoadingConnectionId(null)
    }
  }

  const handleConnectionDelete = (connectionId: string) => {
    if (activeConnection?.id === connectionId) {
      setActiveConnection(null)
    }
    setSavedConnections((prev) => prev.filter((conn) => conn.id !== connectionId))
  }

  const handleConnectionSuccess = (connection: Connection) => {
    // Update saved connections (handles both new and updated connections)
    setSavedConnections((prev) => {
      const exists = prev.find((conn) => conn.id === connection.id)
      if (!exists) {
        // New connection
        return [...prev, connection]
      } else {
        // Updated connection
        return prev.map((conn) =>
          conn.id === connection.id ? { ...conn, ...connection } : conn
        )
      }
    })

    // Only set as active connection if it's a new connection (not an edit)
    const isNewConnection = !savedConnections.find((conn) => conn.id === connection.id)
    if (isNewConnection) {
      setActiveConnection(connection)
    }
  }

  const handleDisconnect = async () => {
    if (activeConnection) {
      try {
        // Call the disconnect API
        await window.api.database.disconnect(activeConnection.id)
        setActiveConnection(null)
      } catch (error) {
        console.error('Error disconnecting:', error)
        // Even if disconnect fails, we should still go back to landing page
        setActiveConnection(null)
      }
    }
  }

  return (
    <div className="app-container">
      <PageTransition transitionKey={activeConnection ? 'active-connection' : 'no-connection'}>
        <MainPanel
          activeConnection={
            activeConnection ? { id: activeConnection.id, name: activeConnection.name } : undefined
          }
          onConnectionSuccess={handleConnectionSuccess}
          connectionLoading={isConnectionLoading}
          loadingConnectionId={loadingConnectionId}
          savedConnections={savedConnections}
          onConnectionSelect={handleConnectionSelect}
          onConnectionDelete={handleConnectionDelete}
          onDisconnect={handleDisconnect}
        />
      </PageTransition>
    </div>
  )
}

export default App
