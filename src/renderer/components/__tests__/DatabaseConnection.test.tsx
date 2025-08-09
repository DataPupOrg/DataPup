import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, userEvent } from '@tests/helpers/test-utils'
import DatabaseConnection from '../DatabaseConnection/DatabaseConnection'

describe('DatabaseConnection Component', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks()
  })

  it('should render connection form', () => {
    render(<DatabaseConnection />)
    
    // Check for form elements
    expect(screen.getByText(/Database Connection/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Host/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Port/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Database/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument()
  })

  it('should handle database type selection', async () => {
    const { user } = render(<DatabaseConnection />)
    
    const typeSelect = screen.getByLabelText(/Type/i)
    await user.selectOptions(typeSelect, 'postgresql')
    
    expect((typeSelect as HTMLSelectElement).value).toBe('postgresql')
  })

  it('should validate required fields', async () => {
    const { user } = render(<DatabaseConnection />)
    
    // Try to submit without filling required fields
    const testButton = screen.getByRole('button', { name: /test connection/i })
    await user.click(testButton)
    
    // Should show validation errors (implementation dependent)
    // This is a placeholder - actual validation behavior depends on implementation
    expect(window.electron.database.testConnection).not.toHaveBeenCalled()
  })

  it('should test database connection', async () => {
    const { user } = render(<DatabaseConnection />)
    
    // Mock successful connection test
    window.electron.database.testConnection = vi.fn().mockResolvedValue({
      success: true,
      message: 'Connection successful'
    })
    
    // Fill in the form
    await user.selectOptions(screen.getByLabelText(/Type/i), 'postgresql')
    await user.type(screen.getByLabelText(/Host/i), 'localhost')
    await user.type(screen.getByLabelText(/Port/i), '5432')
    await user.type(screen.getByLabelText(/Database/i), 'test_db')
    await user.type(screen.getByLabelText(/Username/i), 'test_user')
    await user.type(screen.getByLabelText(/Password/i), 'password')
    
    // Test connection
    const testButton = screen.getByRole('button', { name: /test connection/i })
    await user.click(testButton)
    
    await waitFor(() => {
      expect(window.electron.database.testConnection).toHaveBeenCalledWith({
        type: 'postgresql',
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        username: 'test_user',
        password: 'password',
        ssl: false
      })
    })
  })

  it('should handle connection errors', async () => {
    const { user } = render(<DatabaseConnection />)
    
    // Mock failed connection test
    window.electron.database.testConnection = vi.fn().mockResolvedValue({
      success: false,
      message: 'Connection failed: Invalid credentials'
    })
    
    // Fill minimal required fields
    await user.selectOptions(screen.getByLabelText(/Type/i), 'postgresql')
    await user.type(screen.getByLabelText(/Host/i), 'localhost')
    await user.type(screen.getByLabelText(/Port/i), '5432')
    await user.type(screen.getByLabelText(/Database/i), 'test_db')
    await user.type(screen.getByLabelText(/Username/i), 'wrong_user')
    await user.type(screen.getByLabelText(/Password/i), 'wrong_password')
    
    // Test connection
    const testButton = screen.getByRole('button', { name: /test connection/i })
    await user.click(testButton)
    
    // Should display error message (implementation dependent)
    await waitFor(() => {
      expect(window.electron.database.testConnection).toHaveBeenCalled()
    })
  })

  it('should save connection configuration', async () => {
    const { user } = render(<DatabaseConnection />)
    
    // Mock successful save
    window.electron.storage.saveConnection = vi.fn().mockResolvedValue({
      success: true
    })
    
    window.electron.database.testConnection = vi.fn().mockResolvedValue({
      success: true,
      message: 'Connection successful'
    })
    
    // Fill in the form
    await user.selectOptions(screen.getByLabelText(/Type/i), 'postgresql')
    await user.type(screen.getByLabelText(/Host/i), 'localhost')
    await user.type(screen.getByLabelText(/Port/i), '5432')
    await user.type(screen.getByLabelText(/Database/i), 'production')
    await user.type(screen.getByLabelText(/Username/i), 'admin')
    await user.type(screen.getByLabelText(/Password/i), 'secure_password')
    
    // Save connection
    const saveButton = screen.getByRole('button', { name: /save/i })
    await user.click(saveButton)
    
    await waitFor(() => {
      expect(window.electron.storage.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'postgresql',
          host: 'localhost',
          port: 5432,
          database: 'production',
          username: 'admin'
        })
      )
    })
  })
})