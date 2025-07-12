import { LLMFactory } from '../src/main/llm/factory'
import { LLMConfig } from '../src/main/llm/interface'

/**
 * Example demonstrating Langchain integration in DataPup
 */

// Example 1: Using Langchain Chains with OpenAI
async function exampleLangchainChainsOpenAI() {
  console.log('=== Langchain Chains with OpenAI ===')

  const config: LLMConfig = {
    provider: 'langchain-chains-openai',
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-key',
    model: 'gpt-4o-mini'
  }

  const llm = LLMFactory.create(config)

  const request = {
    naturalLanguageQuery: 'Show me all users with their email addresses',
    databaseSchema: {
      database: 'user_management',
      tables: [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'VARCHAR(255)' },
            { name: 'email', type: 'VARCHAR(255)' },
            { name: 'created_at', type: 'TIMESTAMP' }
          ]
        }
      ]
    },
    databaseType: 'clickhouse'
  }

  try {
    const result = await llm.generateSQL(request)

    if (result.success) {
      console.log('✅ SQL Generated:')
      console.log(result.sqlQuery)
      console.log('\n📝 Explanation:')
      console.log(result.explanation)
    } else {
      console.log('❌ Error:', result.error)
    }
  } catch (error) {
    console.error('❌ Exception:', error)
  }
}

// Example 2: Using Langchain Chains with Gemini
async function exampleLangchainChainsGemini() {
  console.log('\n=== Langchain Chains with Gemini ===')

  const config: LLMConfig = {
    provider: 'langchain-chains-gemini',
    apiKey: process.env.GEMINI_API_KEY || 'your-gemini-key',
    model: 'gemini-1.5-flash'
  }

  const llm = LLMFactory.create(config)

  const request = {
    naturalLanguageQuery: 'Count the number of orders by status',
    databaseSchema: {
      database: 'ecommerce',
      tables: [
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'customer_id', type: 'INTEGER' },
            { name: 'status', type: 'VARCHAR(50)' },
            { name: 'total_amount', type: 'DECIMAL(10,2)' },
            { name: 'created_at', type: 'TIMESTAMP' }
          ]
        }
      ]
    },
    databaseType: 'clickhouse'
  }

  try {
    const result = await llm.generateSQL(request)

    if (result.success) {
      console.log('✅ SQL Generated:')
      console.log(result.sqlQuery)
      console.log('\n📝 Explanation:')
      console.log(result.explanation)
    } else {
      console.log('❌ Error:', result.error)
    }
  } catch (error) {
    console.error('❌ Exception:', error)
  }
}

// Example 3: Using Direct Langchain Models
async function exampleDirectLangchainModels() {
  console.log('\n=== Direct Langchain Models ===')

  const config: LLMConfig = {
    provider: 'langchain-openai',
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-key',
    model: 'gpt-4o-mini'
  }

  const llm = LLMFactory.create(config)

  const request = {
    naturalLanguageQuery: 'Find the top 10 customers by order count',
    databaseSchema: {
      database: 'ecommerce',
      tables: [
        {
          name: 'customers',
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'VARCHAR(255)' },
            { name: 'email', type: 'VARCHAR(255)' }
          ]
        },
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'customer_id', type: 'INTEGER' },
            { name: 'total_amount', type: 'DECIMAL(10,2)' },
            { name: 'created_at', type: 'TIMESTAMP' }
          ]
        }
      ]
    },
    databaseType: 'clickhouse'
  }

  try {
    const result = await llm.generateSQL(request)

    if (result.success) {
      console.log('✅ SQL Generated:')
      console.log(result.sqlQuery)
      console.log('\n📝 Explanation:')
      console.log(result.explanation)
    } else {
      console.log('❌ Error:', result.error)
    }
  } catch (error) {
    console.error('❌ Exception:', error)
  }
}

// Example 4: Query Validation
async function exampleQueryValidation() {
  console.log('\n=== Query Validation ===')

  const config: LLMConfig = {
    provider: 'langchain-chains-openai',
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-key',
    model: 'gpt-4o-mini'
  }

  const llm = LLMFactory.create(config)

  const queries = [
    'SELECT * FROM users WHERE email = "test@example.com"',
    'SELECT * FROM users WHERE email = test@example.com', // Invalid - missing quotes
    'SELECT name, email FROM users ORDER BY created_at DESC',
    'SELECT * FROM non_existent_table' // Invalid table
  ]

  for (const query of queries) {
    try {
      const result = await llm.validateQuery({
        sql: query,
        databaseType: 'clickhouse'
      })

      if (result.isValid) {
        console.log(`✅ Valid: ${query}`)
      } else {
        console.log(`❌ Invalid: ${query} - ${result.error}`)
      }
    } catch (error) {
      console.error(`❌ Exception for query "${query}":`, error)
    }
  }
}

// Example 5: SQL Explanation
async function exampleSQLExplanation() {
  console.log('\n=== SQL Explanation ===')

  const config: LLMConfig = {
    provider: 'langchain-chains-openai',
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-key',
    model: 'gpt-4o-mini'
  }

  const llm = LLMFactory.create(config)

  const complexQuery = `
    SELECT
      c.name,
      COUNT(o.id) as order_count,
      SUM(o.total_amount) as total_spent
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id
    WHERE o.created_at >= '2024-01-01'
    GROUP BY c.id, c.name
    HAVING COUNT(o.id) > 0
    ORDER BY total_spent DESC
    LIMIT 10
  `

  try {
    const explanation = await llm.generateExplanation(complexQuery, 'clickhouse')
    console.log('📝 Query Explanation:')
    console.log(explanation)
  } catch (error) {
    console.error('❌ Exception:', error)
  }
}

// Main function to run all examples
async function runAllExamples() {
  console.log('🚀 DataPup Langchain Integration Examples\n')

  try {
    await exampleLangchainChainsOpenAI()
    await exampleLangchainChainsGemini()
    await exampleDirectLangchainModels()
    await exampleQueryValidation()
    await exampleSQLExplanation()

    console.log('\n✅ All examples completed!')
  } catch (error) {
    console.error('\n❌ Error running examples:', error)
  }
}

// Export functions for individual testing
export {
  exampleLangchainChainsOpenAI,
  exampleLangchainChainsGemini,
  exampleDirectLangchainModels,
  exampleQueryValidation,
  exampleSQLExplanation,
  runAllExamples
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples()
}
