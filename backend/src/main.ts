import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import * as compression from 'compression';

const isProduction = process.env.NODE_ENV === 'production';

const bootstrapLogger = WinstonModule.createLogger({
  level: isProduction ? 'warn' : 'debug',
  format: isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json())
    : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ level, message, timestamp, stack }) =>
        `${timestamp} [${level}] ${stack || message}`,
      ),
    ),
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
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: bootstrapLogger,
  });

  app.use(compression({ level: 6, threshold: 1024 }));

  // Разбираем CORS_ORIGINS из ENV
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://sabt-crm-system-frontend.vercel.app', // фронтенд продакшн
    ];

  // Настройка CORS, безопасная и без ошибок preflight
  app.enableCors({
    origin: allowedOrigins, // массив разрешённых доменов
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // если используешь JWT в куки
  });

  app.useGlobalFilters(new ThrottlerExceptionFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('ERP System API')
    .setDescription('Corporate ERP System REST API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  bootstrapLogger.log(`Backend running on http://localhost:${port}`, 'Bootstrap');
  bootstrapLogger.log(`Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();