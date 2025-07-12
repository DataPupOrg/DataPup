# Langchain Integration in DataPup

This document describes the Langchain integration implemented in DataPup, providing multiple approaches to LLM-based SQL generation using the Langchain framework.

## Overview

DataPup now supports Langchain-based LLM providers alongside the existing direct API implementations. This integration provides:

- **Enhanced Prompt Management**: Using Langchain's PromptTemplate for structured prompts
- **Chain-based Processing**: Leveraging LLMChain for more reliable SQL generation
- **Consistent Interface**: All Langchain implementations implement the same LLMInterface
- **Database Context Integration**: Full integration with DataPup's database context system

## Supported Providers

### Direct Langchain Models

- `langchain-openai`: Uses Langchain's ChatOpenAI
- `langchain-gemini`: Uses Langchain's ChatGoogleGenerativeAI
- `langchain-claude`: Uses Langchain's ChatAnthropic

### Chain-based Models

- `langchain-chains-openai`: Uses LLMChain with ChatOpenAI
- `langchain-chains-gemini`: Uses LLMChain with ChatGoogleGenerativeAI
- `langchain-chains-claude`: Uses LLMChain with ChatAnthropic

## Architecture

### Base Implementation

The `BaseLangchainLLM` class provides common functionality for all Langchain implementations:

```typescript
export abstract class BaseLangchainLLM implements LLMInterface {
  protected model: BaseLanguageModel

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse>
  async validateQuery(request: ValidationRequest): Promise<ValidationResponse>
  async generateExplanation(sql: string, databaseType: string): Promise<string>
}
```

### Provider-Specific Implementations

#### Direct Model Implementations

Located in `src/main/llm/langchain/`:

- `openai.ts`: LangchainOpenAILLM
- `gemini.ts`: LangchainGeminiLLM
- `claude.ts`: LangchainClaudeLLM

These use Langchain's chat models directly with message-based interactions.

#### Chain-based Implementation

Located in `src/main/llm/langchain/chains.ts`:

- `LangchainChainsLLM`: Uses LLMChain for structured processing

This implementation leverages Langchain's chain functionality for more reliable SQL generation.

## Usage

### Basic Usage

```typescript
import { LLMFactory } from './src/main/llm/factory'

// Create a Langchain-based LLM
const config = {
  provider: 'langchain-chains-openai',
  apiKey: 'your-api-key',
  model: 'gpt-4o-mini'
}

const llm = LLMFactory.create(config)

// Generate SQL
const result = await llm.generateSQL({
  naturalLanguageQuery: 'Show me all users',
  databaseSchema: {
    /* schema */
  },
  databaseType: 'clickhouse'
})
```

### Using the LLM Manager

```typescript
import { LLMManager } from './src/main/llm/manager'

const manager = new LLMManager(secureStorage)

// Connect using Langchain provider
const connection = await manager.connect('langchain-chains-gemini', apiKey)

if (connection.success) {
  // Generate SQL using the connection
  const result = await manager.generateSQL(connection.connectionId!, request)
}
```

## Features

### 1. Database Context Integration

All Langchain implementations fully integrate with DataPup's database context system:

```typescript
// Database-specific context is automatically included
const contextProvider = databaseContextRegistry.getProvider(databaseType)
const databaseContext = contextProvider ? contextProvider.generatePromptInstructions() : ''
```

### 2. Structured Prompt Templates

Chain-based implementations use Langchain's PromptTemplate for consistent, structured prompts:

```typescript
const prompt = PromptTemplate.fromTemplate(`
You are a SQL expert specializing in {databaseType} databases.
Your task is to convert natural language queries into accurate SQL statements.

{databaseContext}

DATABASE SCHEMA:
{schema}

NATURAL LANGUAGE QUERY:
"{naturalLanguageQuery}"

Please generate a {databaseType} SQL query that answers this question.
`)
```

### 3. Response Parsing

All implementations include robust response parsing that handles multiple formats:

- Structured format: `SQL: [query] Explanation: [explanation]`
- Markdown code blocks: `sql [query] `
- Fallback extraction based on SQL keywords

### 4. Error Handling

Comprehensive error handling with detailed error messages and fallback mechanisms.

## Configuration

### Model Parameters

All Langchain implementations support standard model parameters:

```typescript
const config = {
  provider: 'langchain-chains-openai',
  apiKey: 'your-api-key',
  model: 'gpt-4o-mini',
  temperature: 0.1,
  maxTokens: 2000
}
```

### Provider-Specific Settings

- **OpenAI**: Uses `modelName` parameter
- **Gemini**: Uses `model` parameter
- **Claude**: Uses `modelName` parameter

## Testing

Run the integration test to verify functionality:

```bash
npm run test:langchain
```

Or run the test file directly:

```bash
npx ts-node test-langchain-integration.ts
```

## Migration from Direct APIs

To migrate from direct API implementations to Langchain:

1. **Update provider names**:
   - `openai` → `langchain-openai` or `langchain-chains-openai`
   - `gemini` → `langchain-gemini` or `langchain-chains-gemini`
   - `claude` → `langchain-claude` or `langchain-chains-claude`

2. **No interface changes required** - all implementations use the same `LLMInterface`

3. **Enhanced functionality** - Langchain implementations provide better prompt management and error handling

## Benefits of Langchain Integration

### 1. **Structured Prompts**

Langchain's PromptTemplate provides type-safe, structured prompt management.

### 2. **Chain-based Processing**

LLMChain provides more reliable and consistent SQL generation.

### 3. **Enhanced Error Handling**

Langchain's built-in error handling and retry mechanisms.

### 4. **Extensibility**

Easy to add new providers and chain types using Langchain's modular architecture.

### 5. **Consistency**

All providers follow the same patterns and interfaces.

## Future Enhancements

### Planned Features

1. **Tool-based SQL Generation**: Implement structured tools for SQL generation
2. **Memory Integration**: Add conversation memory for context-aware queries
3. **Output Parsers**: Implement structured output parsing for more reliable results
4. **Streaming Support**: Add streaming responses for real-time feedback

### Advanced Chains

- **Sequential Chains**: Multi-step SQL generation and validation
- **Router Chains**: Route queries to specialized chains based on complexity
- **Custom Chains**: Database-specific optimization chains

## Troubleshooting

### Common Issues

1. **Import Errors**: Ensure all Langchain dependencies are installed
2. **API Key Issues**: Verify API keys are correctly configured
3. **Model Compatibility**: Check that specified models are available for the provider
4. **Memory Issues**: Langchain models may use more memory than direct APIs

### Debug Mode

Enable verbose logging in chain-based implementations:

```typescript
const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: true // Enable debug output
})
```

## Performance Considerations

### Token Usage

- Chain-based implementations may use more tokens due to structured prompts
- Consider using smaller models for development/testing
- Monitor API usage and costs

### Caching

Langchain provides built-in caching mechanisms that can be enabled for improved performance.

### Batch Processing

For multiple queries, consider implementing batch processing to reduce API calls.

## Security

### API Key Management

- All API keys are stored securely using DataPup's SecureStorage
- Keys are encrypted at rest
- No keys are logged or exposed in error messages

### Input Validation

- All inputs are validated before processing
- SQL injection prevention through proper escaping
- Rate limiting support for API calls

## Contributing

To add new Langchain providers:

1. Create a new implementation extending `BaseLangchainLLM`
2. Add the provider to the factory
3. Update the interface types
4. Add tests for the new provider
5. Update documentation

See the existing implementations in `src/main/llm/langchain/` for examples.
