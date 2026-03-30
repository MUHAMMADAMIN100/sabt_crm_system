import { Module, Global } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${stack || message}${extra}`;
  }),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

const isProduction = process.env.NODE_ENV === 'production';

@Global()
@Module({
  imports: [
    WinstonModule.forRoot({
      level: isProduction ? 'warn' : 'debug',
      format: isProduction ? prodFormat : devFormat,
      transports: [
        new winston.transports.Console(),
        ...(isProduction
          ? [
              new (winston.transports as any).DailyRotateFile({
                filename: 'logs/error-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                level: 'error',
                maxFiles: '30d',
                zippedArchive: true,
              }),
              new (winston.transports as any).DailyRotateFile({
                filename: 'logs/combined-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                maxFiles: '14d',
                zippedArchive: true,
              }),
            ]
          : []),
      ],
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
