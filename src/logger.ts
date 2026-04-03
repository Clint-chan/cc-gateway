import { createWriteStream, mkdirSync, type WriteStream } from 'fs'
import { dirname, resolve } from 'path'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LoggerConfig = {
  level: LogLevel
  audit: boolean
  file?: string
  audit_file?: string
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

let currentLevel: LogLevel = 'info'
let logStream: WriteStream | undefined
let auditStream: WriteStream | undefined

function openStream(filePath?: string) {
  if (!filePath) return undefined

  const resolved = resolve(process.cwd(), filePath)
  mkdirSync(dirname(resolved), { recursive: true })
  return createWriteStream(resolved, {
    flags: 'a',
    encoding: 'utf8',
  })
}

function writeLine(stream: WriteStream | undefined, line: string) {
  if (!stream) return
  stream.write(`${line}\n`)
}

function closeStream(stream: WriteStream | undefined) {
  if (!stream) return
  stream.end()
}

export function setLogLevel(level: LogLevel) {
  currentLevel = level
}

export function initLogger(config: LoggerConfig) {
  setLogLevel(config.level)

  closeStream(logStream)
  closeStream(auditStream)

  logStream = openStream(config.file)
  auditStream = openStream(config.audit_file)
}

export function log(level: LogLevel, message: string, extra?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return

  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}]`
  const line = extra
    ? `${prefix} ${message} ${JSON.stringify(extra)}`
    : `${prefix} ${message}`

  if (extra) {
    console.log(`${prefix} ${message}`, JSON.stringify(extra))
  } else {
    console.log(`${prefix} ${message}`)
  }

  writeLine(logStream, line)
}

export function audit(clientName: string, method: string, path: string, status: number) {
  const ts = new Date().toISOString()
  const line = `[${ts}] [AUDIT] client=${clientName} ${method} ${path} -> ${status}`
  console.log(line)
  writeLine(auditStream || logStream, line)
}
