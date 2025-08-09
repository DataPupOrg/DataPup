import log from 'electron-log/main'

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}
const formatDate = () => {
  const date = new Date()
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

log.initialize({ spyRendererConsole: true })
log.transports.file.fileName = `${formatDate()}.log`
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}]'
log.transports.file.maxSize = 5 * 1024 * 1024

class Logger {
  private level: LogLevel = LogLevel.INFO

  constructor() {
    // Set log level based on environment
    if (process.env.NODE_ENV === 'development') {
      this.level = LogLevel.DEBUG
    } else if (process.env.DEBUG) {
      this.level = LogLevel.DEBUG
    }
  }

  setLevel(level: LogLevel) {
    this.level = level
  }

  error(message: string, ...args: any[]) {
    if (this.level >= LogLevel.ERROR) {
      log.error(`${message}`, ...args)
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level >= LogLevel.WARN) {
      log.warn(`${message}`, ...args)
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level >= LogLevel.INFO) {
      log.info(`${message}`, ...args)
    }
  }

  debug(message: string, ...args: any[]) {
    if (this.level >= LogLevel.DEBUG) {
      log.debug(`${message}`, ...args)
    }
  }
}

export const logger = new Logger()
