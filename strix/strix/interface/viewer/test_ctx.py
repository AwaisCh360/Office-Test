import asyncio
import contextvars
from starlette.concurrency import run_in_threadpool

_sessions = contextvars.ContextVar("_sessions", default=None)

def get_db():
    lst = _sessions.get()
    if lst is not None:
        lst.append("db_connection")
    return "db_connection"

def sync_endpoint():
    get_db()
    get_db()
    return "ok"

async def main():
    token = _sessions.set([])
    try:
        await run_in_threadpool(sync_endpoint)
    finally:
        print("Sessions created:", _sessions.get())
        _sessions.reset(token)

asyncio.run(main())
