import psutil, subprocess, time
from .allowlist import Risk

class AppControlModule:
    def __init__(self, gate, audit):
        self.gate = gate; self.audit = audit
    def launch(self, name, args=None):
        exe = self.gate.check_app(name)
        proc = subprocess.Popen([exe] + (args or []))
        self.audit.log("alex", "app.launch", f"{name} pid={proc.pid}")
        return {"status": "ok", "pid": proc.pid}
    def list_running(self):
        return [{"pid": p.info["pid"], "name": p.info["name"]}
                for p in psutil.process_iter(["pid", "name"])]
    def close(self, name_or_pid, force=False):
        # closing an app is SENSITIVE -> confirm inside gate
        procs = [p for p in psutil.process_iter(["pid", "name"])
                 if str(p.info["pid"]) == str(name_or_pid)
                 or p.info["name"].lower() == str(name_or_pid).lower()]
        for p in procs:
            self.gate.confirm.require(f"Close process {p.info['name']} (pid {p.info['pid']})")
            (p.kill() if force else p.terminate())
        self.audit.log("alex", "app.close", str(name_or_pid))
        return {"closed": [p.info["pid"] for p in procs]}

class SystemModule:
    def __init__(self, gate, audit):
        self.gate = gate
        self.audit = audit

    def sysinfo(self):
        import platform
        import socket

        memory = psutil.virtual_memory()
        disk = psutil.disk_usage("C:\\")

        return {
            "hostname": socket.gethostname(),

            "os": {
                "name": platform.system(),
                "version": platform.version(),
                "release": platform.release(),
                "full": platform.platform(),
            },

            "cpu": {
                "model": platform.processor(),
                "cores": psutil.cpu_count(logical=False),
                "logical_cores": psutil.cpu_count(logical=True),
                "usage_percent": psutil.cpu_percent(interval=0.5),
            },

            "ram": {
                "total_bytes": memory.total,
                "free_bytes": memory.available,
                "used_bytes": memory.used,
                "used_percent": memory.percent,
            },

            "disk": {
                "drive": "C:\\",
                "total_bytes": disk.total,
                "free_bytes": disk.free,
                "used_bytes": disk.used,
                "used_percent": disk.percent,
            },
        }

    def run_approved(self, cmd):
        cmd = self.gate.check_command(cmd)
        out = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )

        self.audit.log("alex", "cmd.run", cmd)

        return {
            "stdout": out.stdout[-8000:],
            "rc": out.returncode
        }