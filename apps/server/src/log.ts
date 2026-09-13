const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const active: Level = (process.env.LOG_LEVEL as Level) in LEVELS
  ? (process.env.LOG_LEVEL as Level)
  : 'info';

function emit(level: Level, message: string): void {
  if (LEVELS[level] > LEVELS[active]) return;
  const stamp = new Date().toISOString().slice(11, 19);
  console.log('[' + stamp + '] ' + level.padEnd(5) + ' ' + message);
}

export const log = {
  error: (m: string) => emit('error', m),
  warn: (m: string) => emit('warn', m),
  info: (m: string) => emit('info', m),
  debug: (m: string) => emit('debug', m),
};
