"""Caido client bootstrap.

The Caido CLI runs as an in-container sidecar listening on
``127.0.0.1:48080`` *inside* the sandbox. We grab a guest token by
``session.exec()``-ing curl from inside the container, then construct
a host-side :class:`caido_sdk_client.Client` against the runtime's
exposed-port URL for all subsequent SDK calls.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import TYPE_CHECKING

from caido_sdk_client import Client, TokenAuthOptions
from caido_sdk_client.types import CreateProjectOptions


if TYPE_CHECKING:
    from agents.sandbox.session import BaseSandboxSession


logger = logging.getLogger(__name__)


_LOGIN_AS_GUEST_BODY = (
    '{"query":"mutation LoginAsGuest { loginAsGuest { token { accessToken } } }"}'
)


async def _login_as_guest(
    session: BaseSandboxSession,
    *,
    container_url: str,
    attempts: int = 10,
) -> str:
    """Use docker cli via subprocess to fetch a guest token; retry until ready.

    Caido's GraphQL listener may not be up the instant the container
    starts. The retry loop also doubles as the Caido readiness probe —
    no separate TCP healthcheck needed. We use subprocess instead of session.exec
    to bypass a known docker-py hang on Mac (exec_run with demux=True).
    """
    import subprocess
    import json
    
    last_err: str | None = None
    inner = getattr(session, "_inner", session)
    state = getattr(inner, "state", None)
    container_id = getattr(state, "container_id", None)
    
    if not container_id:
        raise RuntimeError("Could not determine container ID from session")
        
    for i in range(1, attempts + 1):
        try:
            # We use loop.run_in_executor to not block the event loop
            cmd = [
                "docker", "exec", container_id,
                "curl", "-fsS", "-m", "10", "-X", "POST",
                "-H", "Content-Type: application/json",
                "-d", _LOGIN_AS_GUEST_BODY,
                f"{container_url}/graphql",
            ]
            loop = asyncio.get_running_loop()
            proc = await loop.run_in_executor(
                None,
                lambda: subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            )
            
            if proc.returncode == 0:
                try:
                    payload = json.loads(proc.stdout)
                    token = (
                        payload.get("data", {})
                        .get("loginAsGuest", {})
                        .get("token", {})
                        .get("accessToken")
                    )
                    if token:
                        return str(token)
                    last_err = f"loginAsGuest returned no token: {payload}"
                except json.JSONDecodeError as exc:
                    last_err = f"unparseable response: {exc}: {proc.stdout!r}"
            else:
                last_err = f"curl exit {proc.returncode}: {proc.stderr[:200]}"
        except subprocess.TimeoutExpired:
            last_err = "subprocess.run docker exec timed out after 15s"
        except Exception as exc:
            last_err = f"subprocess docker exec raised: {exc}"
            
        logger.debug("loginAsGuest attempt %d/%d failed: %s", i, attempts, last_err)
        await asyncio.sleep(min(2.0 * i, 8.0))

    raise RuntimeError(f"loginAsGuest failed after {attempts} attempts: {last_err}")


async def bootstrap_caido(
    session: BaseSandboxSession,
    *,
    host_url: str,
    container_url: str,
) -> Client:
    """Connect to the in-container Caido sidecar and select a fresh project."""
    logger.info("Bootstrapping Caido client (host=%s, container=%s)", host_url, container_url)

    access_token = await _login_as_guest(session, container_url=container_url)

    client = Client(host_url, auth=TokenAuthOptions(token=access_token))
    await client.connect()

    try:
        project = await client.project.create(
            CreateProjectOptions(name="sandbox", temporary=True),
        )
        await client.project.select(project.id)
    except BaseException:
        # The connected client never reaches the session bundle if project
        # setup fails, so close it here to avoid leaking the transport.
        with contextlib.suppress(Exception):
            await client.aclose()
        raise
    logger.info("Caido project selected: %s", project.id)
    return client
