"""
ALEX WindowsAgent - SystemModule
System info reads + a strictly allowlisted command layer.
NO arbitrary shell. NO admin elevation. NO destructive OS operations.
"""

import platform
import subprocess
import psutil

from .allowlist import Risk


class SystemModule:
    def __init__(self, gate, audit):
        self.gate = gate          # CapabilityGate
        self.audit = audit        # AuditLogger

    # ---------------------------------------------------------------
    # READ-ONLY system information (Risk.READ -> no confirmation needed)
    # ---------------------------------------------------------------
    def sysinfo(self) -> dict:
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("C:\\")
        info = {
            "os": platform.platform(),
            "os_version": platform.version(),
            "hostname": platform.node(),
            "cpu": platform.processor(),
            "cpu_cores": psutil.cpu_count(logical=True),
            "cpu_percent": psutil.cpu_percent(interval=0.5),
            "ram_total_gb": round(mem.total / (1024 ** 3), 2),
            "ram_used_percent": mem.percent,
            "disk_total_gb": round(disk.total / (1024 ** 3), 2),
            "disk_used_percent": disk.percent,
            "boot_time": psutil.boot_time(),
        }
        self.audit.log("alex", "sys.sysinfo", "read-only system info")
        return info

    def battery(self) -> dict:
        batt = psutil.sensors_battery()
        result = {
            "percent": batt.percent if batt else None,
            "plugged_in": batt.power_plugged if batt else None,
        }
        self.audit.log("alex", "sys.battery", "read battery status")
        return result

    def top_processes(self, count: int = 10) -> list:
        count = min(max(count, 1), 25)  # clamp
        procs = []
        for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
            try:
                procs.append(p.info)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        procs.sort(key=lambda x: (x.get("cpu_percent") or 0), reverse=True)
        self.audit.log("alex", "sys.top_processes", f"top {count}")
        return procs[:count]

    def network_status(self) -> dict:
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()
        interfaces = {}
        for name, addr_list in addrs.items():
            entry = {"up": stats[name].isup if name in stats else False}
            for a in addr_list:
                if a.family == psutil.AF_LINK:
                    entry["mac"] = a.address
                import socket
                if a.family == socket.AF_INET:
                    entry["ipv4"] = a.address
            interfaces[name] = entry
        self.audit.log("alex", "sys.network_status", "read network interfaces")
        return interfaces

    # ---------------------------------------------------------------
    # APPROVED COMMANDS ONLY — exact-match allowlist, no parameters
    # ---------------------------------------------------------------
    def run_approved(self, cmd: str) -> dict:
        cmd = self.gate.check_command(cmd)  # exact match against allowlist, else AccessDenied
        try:
            out = subprocess.run(
                cmd, shell=True, capture_output=True,
                text=True, timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            self.audit.log("alex", "cmd.run", cmd,
                           "ok" if out.returncode == 0 else f"rc={out.returncode}")
            return {
                "status": "ok" if out.returncode == 0 else "failed",
                "stdout": out.stdout[-8000:],
                "stderr": out.stderr[-2000:],
                "rc": out.returncode,
            }
        except subprocess.TimeoutExpired:
            self.audit.log("alex", "cmd.run", cmd, "timeout")
            return {"status": "failed", "reason": "timeout after 30s"}