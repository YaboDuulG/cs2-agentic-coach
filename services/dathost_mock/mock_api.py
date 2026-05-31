from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import uuid
import logging
import asyncio

app = FastAPI(title="DatHost Mock API")
logger = logging.getLogger("dathost_mock")
logging.basicConfig(level=logging.INFO)

# In-memory store
servers = {}

class ConsoleCommand(BaseModel):
    line: str

@app.post("/game-servers")
async def create_server(request: Request):
    form = await request.form()
    logger.info(f"Mock Create Server: {form}")
    
    server_id = str(uuid.uuid4())[:8]
    servers[server_id] = {
        "id": server_id,
        "name": form.get("name", "Mock CS2 Server"),
        "booting": False,
        "on": False,
        "ip": "127.0.0.1",
        "ports": {"game": 27015}
    }
    return servers[server_id]

@app.get("/game-servers/{server_id}")
async def get_server(server_id: str):
    if server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    return servers[server_id]

@app.post("/game-servers/{server_id}/start")
async def start_server(server_id: str):
    if server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    
    servers[server_id]["booting"] = True
    servers[server_id]["on"] = False
    
    # Simulate boot delay in background
    async def boot():
        await asyncio.sleep(5)
        servers[server_id]["booting"] = False
        servers[server_id]["on"] = True
        logger.info(f"Mock server {server_id} is now online.")
        
    asyncio.create_task(boot())
    return {"status": "starting"}

@app.post("/game-servers/{server_id}/stop")
async def stop_server(server_id: str):
    if server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    
    servers[server_id]["on"] = False
    servers[server_id]["booting"] = False
    return {"status": "stopped"}

@app.post("/game-servers/{server_id}/console")
async def console_command(server_id: str, line: str = None):
    # Form-data parses 'line' as a field
    if server_id not in servers:
        raise HTTPException(status_code=404, detail="Server not found")
    
    logger.info(f"[Mock Console {server_id}] -> {line}")
    return {"status": "success", "output": f"Mock executed: {line}"}

@app.delete("/game-servers/{server_id}")
async def delete_server(server_id: str):
    if server_id in servers:
        del servers[server_id]
    return {"status": "deleted"}

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting DatHost Mock API on port 8001")
    uvicorn.run(app, host="0.0.0.0", port=8001)
