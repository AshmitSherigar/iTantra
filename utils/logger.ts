type LogContext = Record<string, unknown> | unknown;

const formatContext = (context?: LogContext): string => {
  if (context === undefined) return '';
  if (context instanceof Error) return ` ${context.message}`;
  if (typeof context === 'string') return ` ${context}`;

  try {
    return ` ${JSON.stringify(context)}`;
  } catch {
    return ' [unserializable context]';
  }
};

const write = (
  level: 'debug' | 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  context?: LogContext,
) => {
  const line = `[${scope}] ${message}${formatContext(context)}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else if (__DEV__) {
    console.log(line);
  }
};

export const logger = {
  debug: (scope: string, message: string, context?: LogContext) =>
    write('debug', scope, message, context),
  info: (scope: string, message: string, context?: LogContext) =>
    write('info', scope, message, context),
  warn: (scope: string, message: string, context?: LogContext) =>
    write('warn', scope, message, context),
  error: (scope: string, message: string, context?: LogContext) =>
    write('error', scope, message, context),
};
