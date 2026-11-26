import { Router, type Request, type Response } from 'express'
import { exec } from 'child_process'
import { hasTool, unavailable } from '../services/unavailable'
import { isDsm, notOnDsm } from '../services/platform'

export interface PowerStatusDeps {
  isDsm?: () => boolean
  hasTool?: (name: string) => boolean
  runVcgencmd?: (cmd: string, cb: (err: Error | null, stdout: string) => void) => void
  cacheMs?: number
  now?: () => number
}

const defaultRunVcgencmd = (cmd: string, cb: (err: Error | null, stdout: string) => void) => {
  exec(
    cmd,
    {
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${process.env.PATH ?? ''}:/usr/bin`,
      },
    },
    (err, stdout) => cb(err, stdout),
  )
}

export function createPowerStatusHandler(deps: PowerStatusDeps = {}) {
  const checkDsm = deps.isDsm ?? isDsm
  const checkTool = deps.hasTool ?? hasTool
  const runVcgencmd = deps.runVcgencmd ?? defaultRunVcgencmd
  const cacheMs = deps.cacheMs ?? 5000
  const nowFn = deps.now ?? Date.now

  type PowerBody = { voltage: number | null; current: null; status: string }
  let cached: { at: number; body: PowerBody } | null = null
  let inFlight: Promise<PowerBody> | null = null

  const readPower = (): Promise<PowerBody> => {
    const t = nowFn()
    if (cached && cacheMs > 0 && t - cached.at < cacheMs) {
      return Promise.resolve(cached.body)
    }
    if (!inFlight) {
      inFlight = new Promise<PowerBody>((resolve) => {
        runVcgencmd('/usr/bin/vcgencmd get_throttled', (throttleErr, throttleOut) => {
          const output = (throttleOut || '').trim()

          let status = 'Unavailable'
          if (!throttleErr) {
            const match = output.match(/throttled=0x([0-9a-fA-F]+)/)
            if (match) {
              const binary = parseInt(match[1], 16).toString(2).padStart(20, '0')
              const undervoltageNow = binary[19] === '1'
              const throttlingNow = binary[18] === '1'
              const undervoltageOccurred = binary[16] === '1'
              const throttlingOccurred = binary[17] === '1'

              if (undervoltageNow || throttlingNow) status = 'Throttling'
              else if (undervoltageOccurred || throttlingOccurred) status = 'Throttled'
              else status = 'Normal'
            }
          }

          runVcgencmd('/usr/bin/vcgencmd measure_volts', (voltErr, voltOut) => {
            let voltage: number | null = null
            if (!voltErr && voltOut) {
              const vmatch = voltOut.trim().match(/volt=([0-9.]+)V/)
              if (vmatch) {
                voltage = parseFloat(vmatch[1])
              }
            }

            resolve({
              voltage,
              current: null,
              status,
            })
          })
        })
      }).then((body) => {
        cached = { at: nowFn(), body }
        inFlight = null
        return body
      })
    }
    return inFlight
  }

  return (_req: Request, res: Response) => {
    if (checkDsm()) return res.json(notOnDsm('Raspberry Pi power status'))
    if (!checkTool('vcgencmd')) {
      return res.json(unavailable('not-supported', 'Raspberry Pi only (vcgencmd not found).'))
    }
    void readPower().then((body) => res.json(body))
  }
}

const router = Router()
router.get('/api/metrics/power-status', createPowerStatusHandler())

export default router
