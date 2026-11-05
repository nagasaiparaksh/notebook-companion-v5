"""Sample notes + diagrams for first-run demos. Runs only when the notes table is empty."""
import json
from db import init_db, standalone, now
from services import layout, rag
NOTES = [
 ("Transformers & Attention", "Deep Learning", ["transformers", "attention", "nlp"],
  "<h2>Attention</h2><p>Attention lets a model weigh which words matter most when reading a sentence instead of treating all words equally.</p><h2>Self-attention</h2><p>In self-attention every word in a sequence looks at every other word. Each word makes a query, key and value vector; the dot product of queries and keys gives weights over the values. This is how 'it' can be linked to 'animal' in 'The animal didn't cross the road because it was tired'.</p><h2>Multi-head</h2><p>Several attention heads run in parallel so the model can learn different relationships at once.</p>"),
 ("Convolutional Neural Networks", "Deep Learning", ["cnn", "vision", "neural-networks"],
  "<h2>Pipeline</h2><p>An input image goes through convolution layers that slide small filters over it to detect edges and textures. ReLU adds non-linearity by zeroing negatives. Pooling shrinks feature maps and keeps the strongest signals. The result is flattened into a vector and passed to fully connected layers that output class scores.</p>"),
 ("Photosynthesis", "Biology", ["biology", "plants", "energy"],
  "<h2>Photosynthesis</h2><p>Plants turn light energy into chemical energy in chloroplasts. Light reactions in the thylakoids split water, release oxygen and make ATP and NADPH. The Calvin cycle in the stroma uses ATP and NADPH to fix carbon dioxide into glucose.</p>"),
 ("Binary Search", "Computer Science", ["algorithms", "search"],
  "<h2>Idea</h2><p>On a sorted array, compare the target with the middle element and discard half the range each step. Runtime is O(log n). Common bug: computing mid as (lo+hi)/2 can overflow in fixed-width integers; use lo + (hi-lo)/2.</p><ul><li>Action: practise 5 binary search problems by Friday</li></ul>"),
]
def D(title, nodes, edges, lay="flow"): return title, layout.build([{"id": a, "label": b, "kind": c} for a, b, c in nodes], [{"from": a, "to": b, "label": l} for a, b, l in edges], lay)
CNN = D("CNN architecture", [("i", "Input image", "rect"), ("c", "Convolution", "rect"), ("r", "ReLU", "ellipse"), ("p", "Pooling", "rect"), ("f", "Flatten", "rect"), ("fc", "Fully connected", "rect"), ("o", "Output", "ellipse")],
        [("i", "c", ""), ("c", "r", ""), ("r", "p", ""), ("p", "f", ""), ("f", "fc", ""), ("fc", "o", "")])
PHOTO = D("Photosynthesis", [("s", "Sunlight", "ellipse"), ("l", "Light reactions (thylakoid)", "rect"), ("a", "ATP + NADPH", "ellipse"), ("c", "Calvin cycle (stroma)", "rect"), ("g", "Glucose", "ellipse"), ("o", "Oxygen", "ellipse")],
        [("s", "l", "light"), ("l", "a", ""), ("l", "o", "from water"), ("a", "c", ""), ("c", "g", "CO2 fixed")])
def run():
    init_db(); db = standalone()
    if db.execute("SELECT 1 FROM notes").fetchone(): db.close(); return
    t = now()
    for i, (title, cat, tags, html) in enumerate(NOTES):
        db.execute("INSERT INTO notes(title,content,category,tags,created,updated,pinned) VALUES(?,?,?,?,?,?,?)", (title, html, cat, json.dumps(tags), t - i * 3600, t - i * 3600, 1 if i == 0 else 0))
    for title, data in (CNN, PHOTO): db.execute("INSERT INTO diagrams(title,data,created,updated) VALUES(?,?,?,?)", (title, json.dumps(data), t, t))
    db.execute("INSERT INTO tasks(note_id,text,deadline) VALUES(4,'Practise 5 binary search problems','Friday')")
    db.commit(); db.close()
    try: rag.reindex_all()
    except Exception as e: print("seed indexing failed:", e)
if __name__ == "__main__": run()
