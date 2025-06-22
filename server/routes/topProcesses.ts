import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/top-processes', (_req, res) => {
  exec('ps -eo pid,comm,%cpu,%mem --sort=-%mem | head -n 6', (err, stdout, stderr) => {
    if (err || stderr) {
      return res.status(500).json({ error: 'Failed to list processes', details: stderr || err.message })
    }
    const lines = stdout.trim().split('\n').slice(1)
    const processes = lines.map(line => {
      const [pid, name, cpu, mem] = line.trim().split(/\s+/, 4)
      return {
        pid: parseInt(pid),
        name,
        cpu: parseFloat(cpu),
        mem: parseFloat(mem)
      }
    })
    res.json(processes)
  })
})

export default router
