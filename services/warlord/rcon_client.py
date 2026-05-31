import asyncio
import logging

from rcon.source import Client

logger = logging.getLogger("warlord.rcon")

async def send_rcon_command(host: str, port: int, password: str, command: str) -> str:
    """
    Sends an RCON command to a Source server (CS2) asynchronously.
    """
    def _run():
        try:
            with Client(host, port, passwd=password, timeout=5.0) as client:
                response = client.run(command)
                return response
        except Exception as e:
            logger.error(f"RCON Error to {host}:{port}: {e}")
            raise

    logger.info(f"[RCON] -> {host}:{port} | Cmd: {command}")
    return await asyncio.to_thread(_run)

async def execute_batch_commands(host: str, port: int, password: str, commands: list[str]) -> list[str]:
    """
    Executes a list of RCON commands sequentially.
    """
    results = []
    def _run_batch():
        try:
            with Client(host, port, passwd=password, timeout=8.0) as client:
                for cmd in commands:
                    logger.info(f"[RCON Batch] -> {host}:{port} | Cmd: {cmd}")
                    resp = client.run(cmd)
                    results.append(resp)
        except Exception as e:
            logger.error(f"RCON Batch Error to {host}:{port}: {e}")
            raise

    await asyncio.to_thread(_run_batch)
    return results
