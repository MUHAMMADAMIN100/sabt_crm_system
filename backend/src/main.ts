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
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';

const isProduction = process.env.NODE_ENV === 'production';

/** Имена MIME-типов, которые НЕЛЬЗЯ отдавать с inline-рендером —
 *  иначе пользователь, заливший .html/.svg, получит stored-XSS в чужом
 *  браузере при просмотре. Картинки/pdf отдаём как обычно. */
const INLINE_SAFE_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const FORCE_DOWNLOAD_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.xml', '.js', '.mjs', '.css',
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.dll',
  '.jar', '.apk', '.app', '.dmg', '.pkg',
]);

/** Валидация критических env-переменных при старте.
 *  Цель: не дать приложению подняться с дефолтными или пустыми секретами.
 *  Это последний рубеж: если кто-то задеплоит без JWT_SECRET, мы упадём
 *  громко в логах, а не молча примем подделанные токены. */
function assertSecurityCriticalEnv() {
  const errors: string[] = [];

  const secret = (process.env.JWT_SECRET || '').trim();
  if (!secret) {
    errors.push('JWT_SECRET is missing — set it to a random 64+ byte hex string');
  } else if (secret.length < 32) {
    errors.push(`JWT_SECRET is too short (${secret.length} chars) — minimum 32 (recommended 64+)`);
  } else if (/^(secret|change(-_)?me|test|dev|default|password|123|jwt[-_]?secret|CHANGE_THIS)/i.test(secret)) {
    errors.push('JWT_SECRET looks like a placeholder — generate a real random value');
  }

  if (isProduction) {
    if (!process.env.DATABASE_URL) errors.push('DATABASE_URL is required in production');
    if (!process.env.CORS_ORIGINS) errors.push('CORS_ORIGINS must be set explicitly in production (no wildcard fallback)');
    if (process.env.NODE_ENV !== 'production') errors.push('NODE_ENV must be "production" in prod build');
  }

  if (errors.length) {
    // eslint-disable-next-line no-console
    console.error('\n╔══════════════════════════════════════════════════════════════╗');
    // eslint-disable-next-line no-console
    console.error('║  STARTUP REFUSED — security-critical env vars are invalid:   ║');
    // eslint-disable-next-line no-console
    console.error('╚══════════════════════════════════════════════════════════════╝');
    for (const e of errors) {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${e}`);
    }
    // eslint-disable-next-line no-console
    console.error('');
    process.exit(1);
  }
}

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
  assertSecurityCriticalEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: bootstrapLogger,
  });

  app.use(compression({ level: 6, threshold: 1024 }));
  // Security HTTP-заголовки: X-Frame-Options, X-Content-Type-Options,
  // Referrer-Policy, Strict-Transport-Security (HSTS) и т.д.
  // CSP отключаем — у нас отдельный фронт, политику задаём на Vercel.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // нужно для /uploads с другого домена
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
  }));
  // cookie-parser нужен, чтобы JwtStrategy могла прочитать токен из httpOnly
  // куки — пользователи больше не хранят JWT в localStorage.
  app.use(cookieParser());

  // Разбираем CORS_ORIGINS из ENV
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://sabt-crm-system-frontend.vercel.app',
    ];

  // Настройка CORS: разрешаем только явно перечисленные origins.
  // Никаких "*"  — иначе SameSite=None cookies сломаются + CSRF.
  app.enableCors({
    origin: (origin, cb) => {
      // origin === undefined → не браузерный запрос (curl, server-to-server)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin "${origin}" is not allowed`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalFilters(new ThrottlerExceptionFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Безопасная отдача статики /uploads/*:
  //  - X-Content-Type-Options: nosniff — браузер не угадает MIME
  //  - Content-Disposition: attachment для всего, что НЕ картинка/видео
  //    (защита от stored-XSS через .html / .svg / .js)
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const lowerPath = filePath.toLowerCase();
      const ext = lowerPath.slice(lowerPath.lastIndexOf('.'));
      const ct = String(res.getHeader('Content-Type') || '').toLowerCase();
      const isInlineSafe =
        INLINE_SAFE_MIME_PREFIXES.some(p => ct.startsWith(p)) ||
        ct === 'application/pdf';
      const isDangerousExt = FORCE_DOWNLOAD_EXTENSIONS.has(ext);
      if (isDangerousExt || !isInlineSafe) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
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
