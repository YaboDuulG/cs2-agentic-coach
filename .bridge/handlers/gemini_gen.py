import os
from google import genai
from dotenv import load_dotenv

# Path Setup
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, "../../.env"))

README_PATH = os.path.abspath(os.path.join(BASE_DIR, "../../README.md"))
SPEC_PATH = os.path.abspath(os.path.join(BASE_DIR, "../TECH_SPEC.md"))

# Initialize the new GenAI Client
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# DEBUG PRINT: Shows only the first 4 and last 4 characters for security
if os.getenv("GEMINI_API_KEY"):
    print(f"🔑 Key Detected: {os.getenv('GEMINI_API_KEY')[:4]}...{os.getenv('GEMINI_API_KEY')[-4:]}")
else:
    print("❌ No Key Detected in environment!")

def generate_spec_with_ai():
    if not os.path.exists(README_PATH):
        print(f"❌ Error: README not found at {README_PATH}")
        return

    print(f"🤖 Gemini (New SDK) is analyzing {README_PATH}...")
    
    with open(README_PATH, "r", encoding="utf-8") as f:
        readme_content = f.read()

    prompt = f"""
    You are a rigid Senior Technical Architect. You only output valid Markdown tasks. 
    You never apologize or add conversational filler. 
    Based on the README below, generate a Technical Specification for a project called 'Agentic AI Coach'.
    
    OUTPUT FORMAT RULES:
    1. Organize by Epics using '#' headers.
    2. For every technical task, use this EXACT format:
       - [ ] **TASK:** [Short Title]
         - **Description:** [1-sentence technical requirement]
         - **Labels:** [comma-separated github labels]
    3. Do not include any conversational text, only the Markdown.

    README CONTENT:
    {readme_content}
    """

    try:
        # New SDK syntax: client.models.generate_content
        response = client.models.generate_content(
            model="gemini-2.0-flash", # You can now use Gemini 2.0!
            contents=prompt,
            config={
                "temperature": 0.1,
                "max_output_tokens": 2048
            }
        )
        
        with open(SPEC_PATH, "w", encoding="utf-8") as f:
            f.write(response.text)
        
        print(f"✅ AI Spec generated at {SPEC_PATH}")
        
    except Exception as e:
        print(f"❌ Generation failed: {e}")

if __name__ == "__main__":
    generate_spec_with_ai()