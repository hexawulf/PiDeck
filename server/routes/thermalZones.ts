import { Router } from 'express'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { unavailable } from '../services/unavailable'

const router = Router()

router.get('/api/metrics/thermal-zones', (_req, res) => {
  try {
    let zones: string[] = []
    try {
      zones = readdirSync('/sys/class/thermal').filter(name => name.startsWith('thermal_zone'))
    } catch {
      zones = []
    }
    if (zones.length === 0) {
      return res.json(unavailable('no-device', 'No thermal sensors exposed (/sys/class/thermal).'))
    }

    const data = zones.map(zone => {
      const typePath = join('/sys/class/thermal', zone, 'type')
      const tempPath = join('/sys/class/thermal', zone, 'temp')
      let label = 'Unknown'
      let tempC = 'N/A'

      try {
        label = readFileSync(typePath, 'utf8').trim()
        const raw = readFileSync(tempPath, 'utf8').trim()
        tempC = (parseInt(raw) / 1000).toFixed(1) + '°C'
      } catch (e) {
        console.warn(`[thermalZones] Failed to read ${zone}:`, e instanceof Error ? e.message : e);
      }

      return { zone, label, temp: tempC }
    })

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Thermal data unavailable' })
  }
})

export default router
