"""Built-in infographic specs for common study topics. Used instantly (no AI call) and as the fallback when the AI is slow or down,
so 'a diagram of RNN and its architecture' always works. Same VSpec shape the AI returns."""
import re

def _s(title, kinds, nodes):
    out = []
    for i, n in enumerate(nodes):
        label, detail, icon = n[0], n[1], n[2]
        out.append({"id": f"n{i}", "label": label, "detail": detail, "icon": icon, "group": n[3] if len(n) > 3 else "", "parent": ""})
    return {"title": title, "kinds": kinds, "nodes": out}

def _tree(title, kinds, root, children):
    spec = _s(title, kinds, [root] + children)
    for n in spec["nodes"][1:]: n["parent"] = "n0"
    return spec

LIB = [
 (r"\blstm\b|long short.?term", _s("LSTM cell", ["process", "mindmap", "list"], [
    ("Input xt + ht-1", "Current input joins the previous hidden state", "📥"), ("Forget gate", "Decides what old memory to drop", "🚪"),
    ("Input gate", "Decides which new information to store", "➕"), ("Cell state Ct", "Long-term memory passed along the sequence", "🧠"),
    ("Output gate", "Decides what part of memory to expose", "📤"), ("Hidden state ht", "Output and short-term memory for next step", "➡️")])),
 (r"\bgru\b|gated recurrent", _s("GRU cell", ["process", "list", "mindmap"], [
    ("Input xt + ht-1", "Current input and previous state", "📥"), ("Reset gate", "How much past to forget when forming the candidate", "🔄"),
    ("Update gate", "Balance between old state and new candidate", "⚖️"), ("Candidate state", "Proposed new hidden state", "💡"), ("Hidden state ht", "Blend of old and candidate states", "➡️")])),
 (r"\brnn\b|\brnns\b|recurrent neural|recurrent network", _s("RNN architecture", ["process", "cycle", "mindmap", "list"], [
    ("Input xt", "One element of the sequence at time t", "📥"), ("Previous state ht-1", "Memory carried over from the last step", "🧠"),
    ("RNN cell", "Combines input and memory with shared weights and tanh", "⚙️"), ("Hidden state ht", "Updated memory, fed to the next step", "🔁"),
    ("Output yt", "Prediction at this step (softmax or linear)", "📤"), ("Unrolled through time", "Same cell repeated for every step; trained with BPTT", "⏱️")])),
 (r"\bcnn\b|convolutional", _s("CNN architecture", ["process", "list", "mindmap"], [
    ("Input image", "Pixels as height × width × channels", "🖼️"), ("Convolution", "Filters slide over the image to detect edges and patterns", "🔍"),
    ("ReLU", "Non-linearity keeps useful activations", "⚡"), ("Pooling", "Shrinks feature maps, keeps the strongest signals", "📉"),
    ("Flatten", "Feature maps become one vector", "➖"), ("Fully connected", "Combines features to decide", "🕸️"), ("Output", "Class probabilities via softmax", "🏷️")])),
 (r"transformer|self.?attention|attention mechanism", _s("Transformer", ["process", "hierarchy", "list"], [
    ("Input tokens", "Text split into tokens", "🔤"), ("Embeddings + position", "Vectors plus positional information", "📍"),
    ("Self-attention", "Every token weighs every other token (Q, K, V)", "👀"), ("Add & normalise", "Residual connection and layer norm", "➕"),
    ("Feed-forward", "Per-token MLP adds capacity", "🧮"), ("Output", "Next-token probabilities or encoded features", "📤")])),
 (r"neural network|perceptron|\bmlp\b|\bann\b", _s("Neural network", ["process", "hierarchy", "list"], [
    ("Input layer", "One neuron per feature", "📥"), ("Hidden layers", "Weighted sums plus activation learn patterns", "🧠"),
    ("Activation function", "ReLU, sigmoid or tanh adds non-linearity", "⚡"), ("Output layer", "Prediction or class probabilities", "📤"),
    ("Loss function", "Measures how wrong the prediction is", "📏"), ("Backpropagation", "Gradients update the weights", "🔙")])),
 (r"gradient descent|backprop", _s("Gradient descent", ["cycle", "process", "list"], [
    ("Initial weights", "Start with random values", "🎲"), ("Forward pass", "Compute predictions", "➡️"), ("Compute loss", "Compare prediction with truth", "📏"),
    ("Compute gradients", "Backpropagation finds the slope for each weight", "📐"), ("Update weights", "Step against the gradient × learning rate", "🔧"), ("Converged?", "Repeat until the loss stops falling", "❓")])),
 (r"speech recognition|\basr\b|speech.to.text", _s("Speech recognition pipeline", ["process", "list", "mindmap"], [
    ("Audio input", "Microphone signal is sampled", "🎙️"), ("Feature extraction", "MFCCs or spectrograms capture the sound", "📊"),
    ("Acoustic model", "Maps sound features to phonemes or characters", "🔊"), ("Language model", "Picks the most likely word sequence", "📚"),
    ("Decoder", "Combines both scores into the best transcript", "🧩"), ("Text output", "Final recognised sentence", "📝")])),
 (r"photosynthesis", _s("Photosynthesis", ["process", "mindmap", "list"], [
    ("Sunlight", "Energy source absorbed by chlorophyll", "☀️"), ("Water", "Taken up by the roots", "💧"), ("Carbon dioxide", "Enters through the stomata", "🌫️"),
    ("Chloroplast", "Where light and carbon reactions occur", "🌿"), ("Glucose", "Sugar stored as food", "🍬"), ("Oxygen", "Released as a by-product", "🫧")])),
 (r"water cycle|hydrological", _s("Water cycle", ["cycle", "process", "list"], [
    ("Evaporation", "Sun heats oceans and lakes", "☀️"), ("Condensation", "Vapour cools into clouds", "☁️"), ("Precipitation", "Rain, snow or hail falls", "🌧️"),
    ("Runoff", "Water flows over land to rivers", "🏞️"), ("Collection", "Returns to oceans and groundwater", "🌊")])),
 (r"binary search", _s("Binary search", ["process", "list", "mindmap"], [
    ("Sorted array", "Required starting point", "📚"), ("Check the middle", "Compare target with the middle element", "🎯"),
    ("Search left half", "If target is smaller", "⬅️"), ("Search right half", "If target is larger", "➡️"), ("Target found", "Stop when equal; O(log n)", "✅")])),
]

def find(text):
    t = (text or "").lower()
    for pat, spec in LIB:
        if re.search(pat, t): return {"title": spec["title"], "kinds": list(spec["kinds"]), "nodes": [dict(n) for n in spec["nodes"]]}
    return None
