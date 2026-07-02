import os

src_file = "agents/great_khan.py"
dest_dir = "agents/khan"
os.makedirs(dest_dir, exist_ok=True)

with open(src_file, "r", encoding="utf-8") as f:
    lines = f.readlines()

def get_section(start_marker, end_marker=None):
    start_idx = -1
    for i, line in enumerate(lines):
        if start_marker in line:
            start_idx = i
            break

    if start_idx == -1: return []

    end_idx = len(lines)
    if end_marker:
        for i in range(start_idx + 1, len(lines)):
            if end_marker in line:
                end_idx = i
                break

    return lines[start_idx:end_idx]

# Since splitting via AST or markers is risky, let's just make smaller files manually by chunking the text
# A safer approach for a 1000 line file is to just leave it as graph.py, and separate out the endpoints.
# The user spec says: Extract agents/khan/ submodule (graph / nodes / prompts / rag / stats)
