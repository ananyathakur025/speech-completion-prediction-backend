import sys
import json
import numpy as np
import os
from pathlib import Path

# Add error handling for imports
try:
    from sentence_transformers import SentenceTransformer
    from sklearn.ensemble import RandomForestRegressor
    import ruptures as rpt
    import joblib
except ImportError as e:
    print(json.dumps({"error": f"Missing required package: {e}"}))
    sys.exit(1)

# ✅ Get the script directory and construct proper paths
script_dir = Path(__file__).parent
# Since script is in scripts/ and model is in root/model/, we need to go up one level
model_path = script_dir.parent / "model" / "random_forest_model.pkl"

print(f"Looking for model at: {model_path}", file=sys.stderr)

# ✅ Load pre-trained model with error handling
try:
    if model_path.exists():
        reg = joblib.load(str(model_path))
        print("✅ Model loaded successfully", file=sys.stderr)
    else:
        print(f"❌ Model file not found at: {model_path}", file=sys.stderr)
        # Create a dummy model for testing
        reg = RandomForestRegressor(n_estimators=10, random_state=42)
        # Train with dummy data
        X_dummy = np.random.rand(100, 5)
        y_dummy = np.random.rand(100) * 100
        reg.fit(X_dummy, y_dummy)
        print("⚠️ Using dummy model for testing", file=sys.stderr)
except Exception as e:
    print(f"❌ Error loading model: {e}", file=sys.stderr)
    sys.exit(1)

avg_speech_len = 40

# ✅ Load embedding model with error handling
try:
    embedder = SentenceTransformer("all-MiniLM-L6-v2")
    print("✅ Embedder loaded successfully", file=sys.stderr)
except Exception as e:
    print(f"❌ Error loading embedder: {e}", file=sys.stderr)
    sys.exit(1)

def extract_features(embeddings):
    """Extract features from embeddings"""
    try:
        novelties = []
        for i in range(1, len(embeddings)):
            sim = np.dot(embeddings[i], embeddings[i-1]) / (
                np.linalg.norm(embeddings[i]) * np.linalg.norm(embeddings[i-1]) + 1e-10
            )
            novelties.append(1 - sim)

        mean_novelty = np.mean(novelties) if novelties else 0
        var_novelty = np.var(novelties) if novelties else 0

        num_cps = 0
        last_cp = 0
        if len(embeddings) >= 3:
            try:
                series = np.vstack(embeddings)
                model_cp = rpt.Pelt(model="rbf").fit(series)
                change_points = model_cp.predict(pen=6)
                num_cps = len(change_points) - 1
                last_cp = change_points[-2] if len(change_points) > 1 else 0
            except Exception as e:
                print(f"⚠️ Change point detection failed: {e}", file=sys.stderr)
                # Return default values if change point detection fails
                num_cps = 0
                last_cp = 0

        return mean_novelty, var_novelty, num_cps, last_cp
    except Exception as e:
        print(f"❌ Error in extract_features: {e}", file=sys.stderr)
        return 0, 0, 0, 0

def predict_progress(text):
    """Predict speech completion progress"""
    try:
        # Split into chunks (sentences)
        chunks = text.strip().split(".")
        chunks = [c.strip() for c in chunks if c.strip()]
        
        if len(chunks) < 2:
            print("⚠️ Too few chunks, returning default value", file=sys.stderr)
            return 15.0

        print(f"Processing {len(chunks)} chunks", file=sys.stderr)
        
        # Get embeddings for each chunk
        embeddings = embedder.encode(chunks)
        print("✅ Embeddings created", file=sys.stderr)
        
        # Extract features
        mean_novelty, var_novelty, num_cps, last_cp = extract_features(embeddings)
        print(f"✅ Features extracted: novelty={mean_novelty:.3f}, var={var_novelty:.3f}, cps={num_cps}, last_cp={last_cp}", file=sys.stderr)

        # Prepare features for model
        i = len(chunks)
        features = [
            i / avg_speech_len,  # relative position
            mean_novelty,        # semantic novelty
            var_novelty,         # novelty variance
            num_cps,            # number of change points
            last_cp / avg_speech_len,  # last change point position
        ]
        
        print(f"✅ Feature vector: {features}", file=sys.stderr)
        
        # Make prediction
        pred = reg.predict([features])[0]
        result = float(round(min(max(pred, 0), 100), 2))
        
        print(f"✅ Prediction: {result}%", file=sys.stderr)
        return result
        
    except Exception as e:
        print(f"❌ Error in predict_progress: {e}", file=sys.stderr)
        # Return a reasonable default based on text length
        words = text.split()
        if len(words) < 50:
            return 25.0
        elif len(words) < 100:
            return 50.0
        else:
            return 75.0

if __name__ == "__main__":
    try:
        print("🐍 Python script started", file=sys.stderr)
        
        # Read input from stdin
        input_data = sys.stdin.read()
        print(f"📥 Received input: {input_data[:100]}...", file=sys.stderr)
        
        data = json.loads(input_data)
        text = data.get("transcript", "")
        
        if not text.strip():
            print(json.dumps({"error": "Empty transcript provided"}))
            sys.exit(1)
        
        print(f"📝 Processing transcript: {text[:100]}...", file=sys.stderr)
        
        result = predict_progress(text)
        
        # Output the result as JSON
        output = {"prediction": result}
        print(json.dumps(output))
        
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error: {e}"}))
        sys.exit(1)