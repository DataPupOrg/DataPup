import { LLMFactory } from './src/main/llm/factory'
import { LLMConfig } from './src/main/llm/interface'

// Test the Langchain integration
async function testLangchainIntegration() {
  console.log('Testing Langchain Integration...')

  // Test configuration
  const config: LLMConfig = {
    provider: 'langchain-chains-openai',
    apiKey: process.env.OPENAI_API_KEY || 'test-key',
    model: 'gpt-4o-mini'
  }

  try {
    // Create LLM instance
    const llm = LLMFactory.create(config)
    console.log('✅ LLM instance created successfully')

    // Test SQL generation
    const request = {
      naturalLanguageQuery: 'Show me all users',
      databaseSchema: {
        database: 'test_db',
        tables: [
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'name', type: 'VARCHAR(255)' },
              { name: 'email', type: 'VARCHAR(255)' }
            ]
          }
        ]
      },
      databaseType: 'clickhouse'
    }

    console.log('Testing SQL generation...')
    const result = await llm.generateSQL(request)

    if (result.success) {
      console.log('✅ SQL generation successful')
      console.log('Generated SQL:', result.sqlQuery)
      console.log('Explanation:', result.explanation)
    } else {
      console.log('❌ SQL generation failed:', result.error)
    }

    // Test query validation
    console.log('Testing query validation...')
    const validationResult = await llm.validateQuery({
      sql: 'SELECT * FROM users',
      databaseType: 'clickhouse'
    })

    if (validationResult.isValid) {
      console.log('✅ Query validation successful')
    } else {
      console.log('❌ Query validation failed:', validationResult.error)
    }

    // Test explanation generation
    console.log('Testing explanation generation...')
    const explanation = await llm.generateExplanation('SELECT * FROM users', 'clickhouse')
    console.log('✅ Explanation generated:', explanation)
  } catch (error) {
    console.error('❌ Test failed:', error)
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testLangchainIntegration()
}

export { testLangchainIntegration }
