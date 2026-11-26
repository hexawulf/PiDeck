import { Router, type Request, type Response } from 'express'
import { exec } from 'child_process'
import { classifyCommandFailure, hasTool, nvmeDevice, SUDO, SUDOERS_HINT, unavailable } from '../services/unavailable'
import { isDsm, notOnDsm } from '../services/platform'

export interface NvmeHandlerDeps {
  isDsm?: () => boolean
  hasTool?: (name: string) => boolean
  nvmeDevice?: () => string | null
  runSmartctl?: (device: string, cb: (err: Error | null, stdout: string, stderr: string) => void) => void
  logError?: (...args: unknown[]) => void
}

export function createNvmeHandler(deps: NvmeHandlerDeps = {}) {
  const checkDsm = deps.isDsm ?? isDsm
  const checkTool = deps.hasTool ?? hasTool
  const findDevice = deps.nvmeDevice ?? nvmeDevice
  const runSmartctl =
    deps.runSmartctl ??
    ((device, cb) => exec(`${SUDO} smartctl -a ${device}`, (err, stdout, stderr) => cb(err, stdout, stderr)))
  const logError = deps.logError ?? ((...args: unknown[]) => console.error(...args))

  return (_req: Request, res: Response) => {
    // DSM: SMART needs root and Synology's own tools (Storage Manager shows it).
    if (checkDsm()) return res.json(notOnDsm('SMART needs root; see Storage Manager'))
    if (!checkTool('smartctl')) {
      return res.json(unavailable('not-installed', 'smartctl not found (apt install smartmontools).'))
    }
    const device = findDevice()
    if (!device) {
      return res.json(unavailable('no-device', 'No NVMe drive found (set PIDECK_NVME_DEVICE if it has another name).'))
    }
    runSmartctl(device, (err, stdout, stderr) => {
      // smartctl uses non-zero exit bits for drive warnings; only give up when there's no output.
      if (err && !stdout.trim()) {
        const reason = classifyCommandFailure(err, stderr)
        if (reason === 'needs-sudoers') return res.json(unavailable(reason, SUDOERS_HINT))
        if (reason) return res.json(unavailable(reason, 'smartctl could not run.'))
        logError('[nvme] smartctl failed:', (stderr || err.message).slice(0, 500))
        return res.status(500).json({ error: 'SMART data unavailable' })
      }

      const lines = stdout.split('\n')
      const metrics: {
        temperature: string | null
        power_on_hours: string | null
        wear_leveling_count: string | null
        media_errors: string | null
      } = {
        temperature: null,
        power_on_hours: null,
        wear_leveling_count: null,
        media_errors: null,
      }

      for (const line of lines) {
        if (line.includes('Temperature:')) metrics.temperature = line.split(':')[1].trim().split(' ')[0]
        if (line.includes('Power On Hours')) metrics.power_on_hours = line.split(':')[1].trim()
        if (line.includes('Wear Leveling Count')) metrics.wear_leveling_count = line.split(':')[1].trim()
        if (line.includes('Media and Data Integrity Errors')) metrics.media_errors = line.split(':')[1].trim()
      }

      res.json(metrics)
    })
  }
}

const router = Router()
router.get('/api/metrics/nvme', createNvmeHandler())

export default router
