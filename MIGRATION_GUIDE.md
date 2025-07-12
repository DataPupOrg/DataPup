# Migration Guide: Direct APIs to Langchain

## Overview

DataPup has been updated to use Langchain-based LLM implementations exclusively. The direct API implementations have been removed to simplify the codebase and provide a more consistent experience.

## What Changed

### Removed Providers

The following direct API providers have been removed:

- `openai` → Use `langchain-openai` or `langchain-chains-openai`
- `claude` → Use `langchain-claude` or `langchain-chains-claude`
- `gemini` → Use `langchain-gemini` or `langchain-chains-gemini`

### New Provider Structure

#### Direct Langchain Models

- `langchain-openai`: Uses Langchain's ChatOpenAI
- `langchain-gemini`: Uses Langchain's ChatGoogleGenerativeAI
- `langchain-claude`: Uses Langchain's ChatAnthropic

#### Chain-based Models (Recommended)

- `langchain-chains-openai`: Uses LLMChain with ChatOpenAI
- `langchain-chains-gemini`: Uses LLMChain with ChatGoogleGenerativeAI
- `langchain-chains-claude`: Uses LLMChain with ChatAnthropic

## Migration Steps

### 1. Update Provider Names

**Before:**

```typescript
const config = {
  provider: 'openai',
  apiKey: 'your-api-key',
  model: 'gpt-4o-mini'
}
```

**After:**

```typescript
const config = {
  provider: 'langchain-chains-openai', // Recommended
  apiKey: 'your-api-key',
  model: 'gpt-4o-mini'
}
```

### 2. Update Connection Calls

**Before:**

```typescript
const connection = await manager.connect('openai', apiKey)
```

**After:**

```typescript
const connection = await manager.connect('langchain-chains-openai', apiKey)
```

### 3. Update Stored Configurations

If you have stored LLM configurations, update them to use the new provider names:

```typescript
// Update any stored configurations
const oldConfig = { provider: 'openai', ... }
const newConfig = { provider: 'langchain-chains-openai', ... }
```

## Benefits of Migration

### 1. **Enhanced Reliability**

- Chain-based processing for more consistent results
- Better error handling and retry mechanisms
- Structured prompt templates

### 2. **Improved Features**

- Better integration with database context system
- Enhanced response parsing
- More robust SQL generation

### 3. **Consistent Architecture**

- All providers use the same Langchain foundation
- Unified error handling and logging
- Easier to maintain and extend

## Provider Recommendations

### For Production Use

**Recommended:** `langchain-chains-*` providers

- More reliable SQL generation
- Better error handling
- Structured processing

### For Development/Testing

**Alternative:** `langchain-*` providers (direct models)

- Faster response times
- Simpler processing
- Good for rapid prototyping

## Example Migrations

### OpenAI Migration

```typescript
// Old
const config = { provider: 'openai', apiKey: 'key', model: 'gpt-4o-mini' }

// New (Recommended)
const config = { provider: 'langchain-chains-openai', apiKey: 'key', model: 'gpt-4o-mini' }

// New (Alternative)
const config = { provider: 'langchain-openai', apiKey: 'key', model: 'gpt-4o-mini' }
```

### Gemini Migration

```typescript
// Old
const config = { provider: 'gemini', apiKey: 'key', model: 'gemini-1.5-flash' }

// New (Recommended)
const config = { provider: 'langchain-chains-gemini', apiKey: 'key', model: 'gemini-1.5-flash' }

// New (Alternative)
const config = { provider: 'langchain-gemini', apiKey: 'key', model: 'gemini-1.5-flash' }
```

### Claude Migration

```typescript
// Old
const config = { provider: 'claude', apiKey: 'key', model: 'claude-3-5-sonnet-20241022' }

// New (Recommended)
const config = {
  provider: 'langchain-chains-claude',
  apiKey: 'key',
  model: 'claude-3-5-sonnet-20241022'
}

// New (Alternative)
const config = { provider: 'langchain-claude', apiKey: 'key', model: 'claude-3-5-sonnet-20241022' }
```

## Testing Your Migration

### 1. Update Test Files

```typescript
// Update any test configurations
const testConfig = {
  provider: 'langchain-chains-openai',
  apiKey: process.env.OPENAI_API_KEY || 'test-key',
  model: 'gpt-4o-mini'
}
```

### 2. Run Integration Tests

```bash
# Test the new Langchain integration
npx ts-node test-langchain-integration.ts

# Run examples
npx ts-node examples/langchain-usage.ts
```

### 3. Verify Functionality

- Test SQL generation
- Test query validation
- Test explanation generation
- Verify error handling

## Troubleshooting

### Common Issues

1. **"Unsupported LLM provider" Error**
   - Ensure you're using the new provider names
   - Check for typos in provider names

2. **API Key Issues**
   - Verify API keys are still valid
   - Check environment variables are set correctly

3. **Model Compatibility**
   - Ensure specified models are available for the provider
   - Check model names match provider requirements

### Getting Help

If you encounter issues during migration:

1. Check the [Langchain Integration Documentation](LANGCHAIN_INTEGRATION.md)
2. Review the [Implementation Summary](LANGCHAIN_IMPLEMENTATION_SUMMARY.md)
3. Run the test examples to verify functionality
4. Check the console for detailed error messages

## Breaking Changes

### Removed Features

- Direct API implementations (`openai`, `claude`, `gemini`)
- Direct SDK usage patterns
- Old provider-specific configurations

### New Requirements

- Langchain dependencies must be installed
- Updated provider names in all configurations
- Potential changes in response format (though interface remains the same)

## Performance Considerations

### Token Usage

- Chain-based implementations may use slightly more tokens
- Consider using smaller models for development
- Monitor API usage and costs

### Response Times

- Chain-based processing may be slightly slower
- Direct Langchain models are faster than chains
- Trade-off between reliability and speed

## Future Enhancements

With the Langchain foundation in place, future enhancements will include:

1. **Tool-based SQL Generation**
2. **Memory Integration**
3. **Output Parsers**
4. **Streaming Support**
5. **Advanced Chains**

## Conclusion

The migration to Langchain-only providers provides:

- **Better reliability** through structured processing
- **Enhanced features** with improved error handling
- **Consistent architecture** across all providers
- **Future extensibility** for advanced features

The migration is straightforward and provides significant improvements in SQL generation quality and reliability.
