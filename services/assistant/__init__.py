"""
In-app assistant (docs/assistant_plan.md).
==========================================
One tool registry (`tools.py`) serves two front doors: the in-app chat loop
(Gemini function calling, in-process) and, later, an MCP server for outside
assistants. Every handler runs as the signed-in user and does its own access
check, so the model can never read what its caller cannot. `policy.py` says
who may use the assistant and how much per day.
"""
