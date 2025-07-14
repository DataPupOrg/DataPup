#!/bin/bash

echo "🚀 Starting Python Embedding Server..."

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

# Check if pip is available
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip3 first."
    exit 1
fi

# Check if the server file exists
if [ ! -f "embed_server.py" ]; then
    echo "❌ embed_server.py not found. Please make sure you're in the correct directory."
    exit 1
fi

# Check if dependencies are installed
echo "📦 Checking dependencies..."
python3 -c "import flask, sentence_transformers, sklearn" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️ Some dependencies are missing. Installing..."
    pip3 install flask sentence-transformers scikit-learn
fi

# Set environment variables to suppress warnings
export PYTHONWARNINGS="ignore"
export WERKZEUG_RUN_MAIN="true"

# Start the server with clean output
echo "🔧 Starting embedding server on port 5001..."
echo "📝 The model will take ~30 seconds to load on first run..."
echo "📊 Server will be available at http://localhost:5001"
echo ""

# Run with suppressed warnings
python3 -W ignore embed_server.py 2>/dev/null
