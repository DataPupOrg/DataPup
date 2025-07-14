# embed_server.py
import warnings
import logging
from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer

# Suppress PyTorch image extension warnings
warnings.filterwarnings("ignore", message="Failed to load image Python extension")
warnings.filterwarnings("ignore", category=UserWarning, module="torchvision")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load the model once when the server starts
print("Loading embedding model...")
model = SentenceTransformer('all-MiniLM-L6-v2')
print("Model loaded successfully!")

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'model': 'all-MiniLM-L6-v2'})

@app.route('/embed', methods=['POST'])
def embed():
    """Generate embeddings for text"""
    try:
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'Invalid input, "text" field is required'}), 400

        # Generate the embedding
        text = data['text']
        logger.info(f"Generating embedding for text: {text[:50]}...")

        embedding = model.encode(text).tolist()  # .tolist() converts numpy array to a plain list

        logger.info(f"Generated embedding with {len(embedding)} dimensions")
        return jsonify({'embedding': embedding})

    except Exception as e:
        logger.error(f"Error generating embedding: {str(e)}")
        return jsonify({'error': f'Failed to generate embedding: {str(e)}'}), 500

@app.route('/batch_embed', methods=['POST'])
def batch_embed():
    """Generate embeddings for multiple texts"""
    try:
        data = request.get_json()
        if not data or 'texts' not in data:
            return jsonify({'error': 'Invalid input, "texts" field is required'}), 400

        texts = data['texts']
        if not isinstance(texts, list):
            return jsonify({'error': '"texts" must be a list'}), 400

        logger.info(f"Generating embeddings for {len(texts)} texts...")

        # Generate embeddings for all texts
        embeddings = model.encode(texts).tolist()

        logger.info(f"Generated {len(embeddings)} embeddings")
        return jsonify({'embeddings': embeddings})

    except Exception as e:
        logger.error(f"Error generating batch embeddings: {str(e)}")
        return jsonify({'error': f'Failed to generate embeddings: {str(e)}'}), 500

@app.route('/similarity', methods=['POST'])
def similarity():
    """Calculate cosine similarity between two texts"""
    try:
        data = request.get_json()
        if not data or 'text1' not in data or 'text2' not in data:
            return jsonify({'error': 'Invalid input, "text1" and "text2" fields are required'}), 400

        text1 = data['text1']
        text2 = data['text2']

        logger.info(f"Calculating similarity between texts...")

        # Generate embeddings
        embedding1 = model.encode(text1)
        embedding2 = model.encode(text2)

        # Calculate cosine similarity
        from sklearn.metrics.pairwise import cosine_similarity
        similarity_score = cosine_similarity([embedding1], [embedding2])[0][0]

        logger.info(f"Similarity score: {similarity_score}")
        return jsonify({'similarity': float(similarity_score)})

    except Exception as e:
        logger.error(f"Error calculating similarity: {str(e)}")
        return jsonify({'error': f'Failed to calculate similarity: {str(e)}'}), 500

if __name__ == '__main__':
    print("Starting embedding server on port 5001...")
    print("Available endpoints:")
    print("  GET  /health - Health check")
    print("  POST /embed - Generate single embedding")
    print("  POST /batch_embed - Generate multiple embeddings")
    print("  POST /similarity - Calculate similarity between texts")
    # Suppress Flask development server warning
    import os
    os.environ['WERKZEUG_RUN_MAIN'] = 'true'
    app.run(host='0.0.0.0', port=5001, debug=False)
