// Cross-platform CPU/RAM/process snapshot for the admin resource monitor.
// Uses systeminformation instead of hand-parsing `tasklist`/`ps` so this
// works the same on Windows (Electron dev) and the Linux VPS.
const si = require("systeminformation");

const TOP_PROCESS_COUNT = 15;

async function getStats() {
  const [cpu, mem, time, procs] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.time(),
    si.processes(),
  ]);

  const topProcesses = [...procs.list]
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, TOP_PROCESS_COUNT)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round(p.cpu * 10) / 10,
      memMB: Math.round(p.memRss / 1024), // memRss is reported in KB
    }));

  return {
    cpu: { load: Math.round(cpu.currentLoad * 10) / 10 },
    mem: {
      totalMB: Math.round(mem.total / 1024 / 1024),
      usedMB: Math.round((mem.total - mem.available) / 1024 / 1024),
      usedPercent: Math.round(((mem.total - mem.available) / mem.total) * 1000) / 10,
    },
    uptimeSec: time.uptime,
    processCount: procs.all,
    topProcesses,
  };
}

module.exports = { getStats };
