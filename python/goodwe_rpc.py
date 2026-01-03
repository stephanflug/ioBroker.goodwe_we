#!/usr/bin/env python3
import argparse
import asyncio
import json
import sys
from typing import Any, Dict, Optional

import goodwe


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--host", required=True)
    p.add_argument("--protocol", choices=["UDP", "TCP"], default="UDP")
    p.add_argument("--timeout", type=int, default=5)
    p.add_argument("--retries", type=int, default=20)
    return p.parse_args()


def _port(protocol: str) -> int:
    return 8899 if protocol.upper() == "UDP" else 502


async def main():
    a = parse_args()
    inv: Optional[Any] = None

    async def ensure_connected():
        nonlocal inv
        if inv is None:
            inv = await goodwe.connect(
                host=a.host,
                port=_port(a.protocol),
                timeout=a.timeout,
                retries=a.retries,
            )
        return inv

    async def read_stdin_line() -> str:
        return await asyncio.to_thread(sys.stdin.readline)

    def reply(msg: Dict[str, Any]) -> None:
        sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    while True:
        line = await read_stdin_line()
        if not line:
            break
        line = line.strip()
        if not line:
            continue

        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd")

            inverter = await ensure_connected()

            if cmd == "get_sensors":
                sensors = []
                for s in inverter.sensors():
                    sensors.append({"id": s.id_, "name": s.name, "unit": s.unit})
                reply({"id": req_id, "ok": True, "data": sensors})

            elif cmd == "read_runtime":
                data = await inverter.read_runtime_data()
                reply({"id": req_id, "ok": True, "data": data})

            elif cmd == "get_min_soc":
                dod = int(await inverter.get_ongrid_battery_dod())
                min_soc = 100 - dod
                reply({"id": req_id, "ok": True, "data": {"min_soc": min_soc, "ongrid_dod": dod}})

            elif cmd == "set_min_soc":
                min_soc = int(req.get("value"))
                min_soc = max(0, min(100, min_soc))
                dod = 100 - min_soc
                dod = max(0, min(99, dod))
                await inverter.set_ongrid_battery_dod(dod)
                reply({"id": req_id, "ok": True, "data": {"applied_min_soc": 100 - dod, "applied_ongrid_dod": dod}})

            else:
                reply({"id": req_id, "ok": False, "error": f"Unknown cmd: {cmd}"})

        except Exception as e:
            inv = None  # reconnect next time
            reply({"id": req_id, "ok": False, "error": str(e)})


if __name__ == "__main__":
    asyncio.run(main())
