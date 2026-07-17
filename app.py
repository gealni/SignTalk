import os
# Configure Keras to use the PyTorch backend
os.environ["KERAS_BACKEND"] = "torch"

import io
import base64
import numpy as np
from PIL import Image
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import keras

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)  # Enable CORS for development flexibility

MODEL_PATH = "best_bisindo_alphabet_model.keras"
print(f"Loading Keras model from {MODEL_PATH} with backend: {keras.config.backend()}...")
model = keras.saving.load_model(MODEL_PATH)
print("Model loaded successfully!")

# BISINDO Alphabet classes A-Z
CLASSES = [chr(i) for i in range(ord('A'), ord('Z') + 1)]

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json(silent=True)
        if not data or 'image' not in data:
            return jsonify({'error': 'Missing image data in request'}), 400

        # Extract base64 image data
        image_data = data['image']
        if ',' in image_data:
            image_data = image_data.split(',')[1]

        # Decode base64 bytes to PIL Image
        img_bytes = base64.b64decode(image_data)
        img = Image.open(io.BytesIO(img_bytes)).convert('RGB')

        # Preprocess: resize to 224x224 as expected by the EfficientNetV2 model
        img_resized = img.resize((224, 224))
        
        # Convert to numpy array and prepare for Keras prediction
        # Input shape expected: (batch_size, 224, 224, 3)
        img_array = np.array(img_resized, dtype=np.float32)
        img_array = np.expand_dims(img_array, axis=0) # Shape is now (1, 224, 224, 3)

        # Run inference
        # Keras 3 model returns a PyTorch tensor (if backend=torch) which we convert to numpy
        preds = model(img_array, training=False)
        
        # If it is a PyTorch tensor, convert it to numpy
        if hasattr(preds, 'detach'):
            preds = preds.detach().cpu().numpy()
        else:
            preds = np.array(preds)
            
        preds = preds[0] # Get predictions for the single batch item

        best_idx = int(np.argmax(preds))
        confidence = float(preds[best_idx])
        predicted_letter = CLASSES[best_idx]

        # Detailed predictions for debugging or visualization charts
        detailed_preds = {CLASSES[i]: float(preds[i]) for i in range(len(CLASSES))}

        return jsonify({
            'letter': predicted_letter,
            'confidence': confidence,
            'predictions': detailed_preds
        })

    except Exception as e:
        print(f"Error during prediction: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Run server on port 5000
    app.run(host='0.0.0.0', port=5000, debug=True)
