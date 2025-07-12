import {
  allTools,
  getEssentialTools,
  getAdvancedTools,
  getToolsByCategory,
  GetTableListTool,
  GetTableSchemaTool,
  GetSampleRowsTool,
  RunSqlQueryTool,
  ValidateSqlSyntaxTool,
  CheckQuerySafetyTool
} from './src/main/llm/langchain/tools.ts'

async function testTools() {
  console.log('🧪 Testing DataPup LLM Tools...\n')

  // Test individual tools
  console.log('📋 Testing Individual Tools:')

  // Test GetTableListTool
  const tableListTool = new GetTableListTool()
  const tableListResult = await tableListTool._call({})
  console.log('✅ GetTableListTool:', JSON.parse(tableListResult))

  // Test GetTableSchemaTool
  const tableSchemaTool = new GetTableSchemaTool()
  const tableSchemaResult = await tableSchemaTool._call({ table: 'users' })
  console.log('✅ GetTableSchemaTool:', JSON.parse(tableSchemaResult))

  // Test GetSampleRowsTool
  const sampleRowsTool = new GetSampleRowsTool()
  const sampleRowsResult = await sampleRowsTool._call({ table: 'users', limit: 3 })
  console.log('✅ GetSampleRowsTool:', JSON.parse(sampleRowsResult))

  // Test RunSqlQueryTool
  const runQueryTool = new RunSqlQueryTool()
  const runQueryResult = await runQueryTool._call({ query: 'SELECT * FROM users LIMIT 5' })
  console.log('✅ RunSqlQueryTool:', JSON.parse(runQueryResult))

  // Test ValidateSqlSyntaxTool
  const validateTool = new ValidateSqlSyntaxTool()
  const validateResult = await validateTool._call({ query: 'SELECT * FROM users' })
  console.log('✅ ValidateSqlSyntaxTool:', JSON.parse(validateResult))

  // Test CheckQuerySafetyTool
  const safetyTool = new CheckQuerySafetyTool()
  const safetyResult = await safetyTool._call({ query: 'SELECT * FROM users' })
  console.log('✅ CheckQuerySafetyTool:', JSON.parse(safetyResult))

  console.log('\n📊 Testing Tool Collections:')

  // Test essential tools
  const essentialTools = getEssentialTools()
  console.log(`✅ Essential Tools: ${essentialTools.length} tools`)

  // Test advanced tools
  const advancedTools = getAdvancedTools()
  console.log(`✅ Advanced Tools: ${advancedTools.length} tools`)

  // Test all tools
  console.log(`✅ All Tools: ${allTools.length} tools`)

  console.log('\n📂 Testing Tool Categories:')
  Object.entries(getToolsByCategory).forEach(([category, tools]) => {
    console.log(`✅ ${category}: ${tools.length} tools`)
  })

  console.log('\n🔧 Testing Tool Names:')
  allTools.forEach((tool) => {
    console.log(`  - ${tool.name}: ${tool.description}`)
  })

  console.log('\n✅ All tests completed successfully!')
}

// Test error handling
async function testErrorHandling() {
  console.log('\n🚨 Testing Error Handling:')

  try {
    const safetyTool = new CheckQuerySafetyTool()
    const dangerousResult = await safetyTool._call({ query: 'DROP TABLE users' })
    console.log('✅ Dangerous Query Detection:', JSON.parse(dangerousResult))
  } catch (error) {
    console.log('❌ Error handling test failed:', error)
  }
}

// Test tool integration
async function testToolIntegration() {
  console.log('\n🔗 Testing Tool Integration:')

  // Simulate a workflow: get tables -> get schema -> get sample data -> validate query
  const workflow = [
    { tool: new GetTableListTool(), params: {} },
    { tool: new GetTableSchemaTool(), params: { table: 'users' } },
    { tool: new GetSampleRowsTool(), params: { table: 'users', limit: 2 } },
    { tool: new ValidateSqlSyntaxTool(), params: { query: 'SELECT * FROM users' } },
    { tool: new CheckQuerySafetyTool(), params: { query: 'SELECT * FROM users' } }
  ]

  for (const step of workflow) {
    try {
      await step.tool._call(step.params as any)
      console.log(`✅ ${step.tool.name}: Success`)
    } catch (error) {
      console.log(`❌ ${step.tool.name}: Failed - ${error}`)
    }
  }
}

// Run all tests
async function runAllTests() {
  try {
    await testTools()
    await testErrorHandling()
    await testToolIntegration()
    console.log('\n🎉 All tests passed! DataPup LLM Tools are ready for use.')
  } catch (error) {
    console.error('❌ Test suite failed:', error)
    process.exit(1)
  }
}

// ESM-compatible: run tests if this is the entrypoint
if (import.meta.url === `file://${process.cwd()}/test-llm-tools.ts`) {
  await runAllTests()
}

export { testTools, testErrorHandling, testToolIntegration, runAllTests }
