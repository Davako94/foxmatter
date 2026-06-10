// utils/logger.js - Lightweight structured logger for Foxmatter
// No external deps; uses console with ISO timestamps and log levels.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);

function formatMessage(level, message, ...args) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase().padEnd(5)}]`;
  const extra = args.length
    ? args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    : '';
  return `${prefix} ${message}${extra ? ' ' + extra : ''}`;
}

function makeLogger() {
  return {
    debug: (msg, ...args) => {
      if (LEVELS.debug >= MIN_LEVEL) console.debug(formatMessage('debug', msg, ...args));
    },
    info: (msg, ...args) => {
      if (LEVELS.info >= MIN_LEVEL) console.info(formatMessage('info', msg, ...args));
    },
    warn: (msg, ...args) => {
      if (LEVELS.warn >= MIN_LEVEL) console.warn(formatMessage('warn', msg, ...args));
    },
    error: (msg, ...args) => {
      if (LEVELS.error >= MIN_LEVEL) console.error(formatMessage('error', msg, ...args));
    },
  };
}

const logger = makeLogger();

module.exports = { logger };