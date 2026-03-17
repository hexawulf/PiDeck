import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/ram', (_req, res) => {
  exec("free -m | awk '/Mem:/ {print $2, $3, $4}'", (err, stdout) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read memory', details: err.message });
    }
    const [totalStr, usedStr, freeStr] = stdout.trim().split(/\s+/)
    const total = parseInt(totalStr)
    const used = parseInt(usedStr)
    const free = parseInt(freeStr)
    const usage = total > 0 ? Math.round((used / total) * 100) : 0
    res.json({ total, used, free, usage })
  })
})

router.get('/api/metrics/swap', (_req, res) => {
  exec("free -m | awk '/Swap:/ {print $2, $3, $4}'", (err, stdout) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read swap', details: err.message });
    }
    const [totalStr, usedStr, freeStr] = stdout.trim().split(/\s+/)
    const total = parseInt(totalStr)
    const used = parseInt(usedStr)
    const free = parseInt(freeStr)
    res.json({ total, used, free })
  })
})

export default router
