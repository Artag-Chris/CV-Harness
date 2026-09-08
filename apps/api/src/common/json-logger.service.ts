import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

/**
 * Logger JSON para que los eventos del pipeline sean grepeables y observables.
 */
@Injectable()
export class JsonLogger extends ConsoleLogger {
  private write(level: LogLevel, message: unknown, context?: string) {
    const entry = {
      time: new Date().toISOString(),
      level,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      context: context ?? this.context,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  log(message: unknown, context?: string) {
    this.write('log', message, context);
  }
  warn(message: unknown, context?: string) {
    this.write('warn', message, context);
  }
  error(message: unknown, stackOrContext?: string, context?: string) {
    this.write('error', message, context ?? stackOrContext);
  }
  debug(message: unknown, context?: string) {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write('verbose', message, context);
  }
}
