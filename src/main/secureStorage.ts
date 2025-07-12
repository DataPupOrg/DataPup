import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

interface DatabaseConnection {
  id: string
  name: string
  type: string
  host: string
  port: number
  database: string
  username: string
  password: string
  secure?: boolean
  readonly?: boolean
  createdAt: string
  lastUsed?: string
}

interface EncryptedConnection {
  id: string
  name: string
  type: string
  host: string
  port: number
  database: string
  username: string
  encryptedPassword: string
  secure?: boolean
  readonly?: boolean
  createdAt: string
  lastUsed?: string
}

class SecureStorage {
  private storagePath: string
  private encryptionKey: string

  constructor() {
    // Use app-specific user data directory
    this.storagePath = join(app.getPath('userData'), 'connections.json')

    // Generate a machine-specific encryption key
    // In production, you might want to use the system keychain
    this.encryptionKey = this.generateEncryptionKey()

    // Ensure the directory exists
    const dir = join(app.getPath('userData'))
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  private generateEncryptionKey(): string {
    // Use a combination of machine-specific identifiers
    const machineId = app.getPath('userData')
    const appName = app.getName()
    const version = app.getVersion()

    // Create a deterministic but unique key for this machine/app combination
    return createHash('sha256').update(`${machineId}-${appName}-${version}`).digest('hex')
  }

  private encrypt(text: string): string {
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey.slice(0, 32)), iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return iv.toString('hex') + ':' + encrypted
  }

  private decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = createDecipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey.slice(0, 32)),
      iv
    )
    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  private loadConnections(): EncryptedConnection[] {
    try {
      if (!existsSync(this.storagePath)) {
        return []
      }
      const data = readFileSync(this.storagePath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      console.error('Error loading connections:', error)
      return []
    }
  }

  private saveConnections(connections: EncryptedConnection[]): void {
    try {
      writeFileSync(this.storagePath, JSON.stringify(connections, null, 2), 'utf8')
    } catch (error) {
      console.error('Error saving connections:', error)
      throw error
    }
  }

  saveConnection(connection: DatabaseConnection): void {
    const connections = this.loadConnections()

    const encryptedConnection: EncryptedConnection = {
      id: connection.id,
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      encryptedPassword: this.encrypt(connection.password),
      secure: connection.secure,
      readonly: connection.readonly,
      createdAt: connection.createdAt,
      lastUsed: connection.lastUsed
    }

    // Check if connection with same ID already exists
    const existingIndex = connections.findIndex((c) => c.id === connection.id)
    if (existingIndex >= 0) {
      connections[existingIndex] = encryptedConnection
    } else {
      connections.push(encryptedConnection)
    }

    this.saveConnections(connections)
  }

  getConnections(): DatabaseConnection[] {
    const encryptedConnections = this.loadConnections()

    return encryptedConnections.map((conn) => ({
      id: conn.id,
      name: conn.name,
      type: conn.type,
      host: conn.host,
      port: conn.port,
      database: conn.database,
      username: conn.username,
      password: this.decrypt(conn.encryptedPassword),
      secure: conn.secure,
      readonly: conn.readonly,
      createdAt: conn.createdAt,
      lastUsed: conn.lastUsed
    }))
  }

  getConnection(id: string): DatabaseConnection | null {
    const connections = this.getConnections()
    return connections.find((conn) => conn.id === id) || null
  }

  deleteConnection(id: string): boolean {
    const connections = this.loadConnections()
    const initialLength = connections.length
    const filteredConnections = connections.filter((conn) => conn.id !== id)

    if (filteredConnections.length < initialLength) {
      this.saveConnections(filteredConnections)
      return true
    }
    return false
  }

  updateLastUsed(id: string): void {
    const connections = this.loadConnections()
    const connection = connections.find((conn) => conn.id === id)

    if (connection) {
      connection.lastUsed = new Date().toISOString()
      this.saveConnections(connections)
    }
  }

  // Test the encryption/decryption
  testEncryption(): boolean {
    try {
      const testData = 'test-password-123'
      const encrypted = this.encrypt(testData)
      const decrypted = this.decrypt(encrypted)
      return testData === decrypted
    } catch (error) {
      console.error('Encryption test failed:', error)
      return false
    }
  }

  // Generic key-value storage methods
  private getGenericStoragePath(): string {
    return join(app.getPath('userData'), 'generic-storage.json')
  }

  private loadGenericStorage(): Record<string, string> {
    try {
      const path = this.getGenericStoragePath()
      if (!existsSync(path)) {
        return {}
      }
      const data = readFileSync(path, 'utf8')
      const encryptedData = JSON.parse(data)
      const decryptedData: Record<string, string> = {}

      for (const [key, encryptedValue] of Object.entries(encryptedData)) {
        decryptedData[key] = this.decrypt(encryptedValue as string)
      }

      return decryptedData
    } catch (error) {
      console.error('Error loading generic storage:', error)
      return {}
    }
  }

  private saveGenericStorage(data: Record<string, string>): void {
    try {
      const path = this.getGenericStoragePath()
      const encryptedData: Record<string, string> = {}

      for (const [key, value] of Object.entries(data)) {
        encryptedData[key] = this.encrypt(value)
      }

      writeFileSync(path, JSON.stringify(encryptedData, null, 2), 'utf8')
    } catch (error) {
      console.error('Error saving generic storage:', error)
      throw error
    }
  }

  get(key: string): string | null {
    const storage = this.loadGenericStorage()
    return storage[key] || null
  }

  set(key: string, value: string): void {
    const storage = this.loadGenericStorage()
    storage[key] = value
    this.saveGenericStorage(storage)
  }

  delete(key: string): void {
    const storage = this.loadGenericStorage()
    delete storage[key]
    this.saveGenericStorage(storage)
  }
}

export { SecureStorage }
export type { DatabaseConnection, EncryptedConnection }
