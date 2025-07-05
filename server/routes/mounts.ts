import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/mounts', (_req, res) => {
  exec('mount | grep -v snap', (err, stdout, stderr) => {
    if (err || stderr) {
      const details = stderr || (err ? err.message : "Unknown exec error");
      return res.status(500).json({ error: 'Failed to run mount', details });
    }

    const lines = stdout.trim().split('\n')
    const mounts = lines.map(line => {
      const match = line.match(/^(.+?) on (.+?) type (.+?) \((.+?)\)$/)
      if (!match) return null
      const [, device, mountpoint, fstype, options] = match
      return { device, mountpoint, fstype, options }
    }).filter(Boolean)

    res.json(mounts)
  })
})

export default router
