import { Router } from 'express'
import { exec } from 'child_process'

const router = Router()

router.get('/api/metrics/filesystems', (_req, res) => {
  exec('df -h --output=source,size,used,avail,pcent,target', (err, stdout, stderr) => {
    if (err || stderr) {
      return res.status(500).json({ error: 'Failed to run df -h', details: stderr || err.message })
    }

    const lines = stdout.trim().split('\n').slice(1) // skip header
    const entries = lines
      .map(line => line.trim().split(/\s+/))
      .filter(([src]) => !src.startsWith('tmpfs') && !src.startsWith('loop') && !src.includes('snap') && !src.includes('squashfs'))
      .map(([source, size, used, avail, pcent, target]) => ({
        source, size, used, avail, pcent, mount: target
      }))

    res.json(entries)
  })
})

export default router
