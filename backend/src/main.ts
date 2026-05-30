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

/** Список known-placeholder'ов из .env.example.
 *  Если env-переменная равна одному из этих значений — она дефолтная и не работает. */
const ENV_PLACEHOLDERS: Record<string, string[]> = {
  JWT_SECRET: ['CHANGE_THIS_TO_RANDOM_64_BYTE_HEX'],
  DATABASE_URL: ['postgresql://erp_user:STRONG_PASSWORD@localhost:5432/erp_db'],
  APP_URL: ['https://your-frontend.vercel.app'],
  CORS_ORIGINS: ['https://your-frontend.vercel.app'],
  BREVO_API_KEY: ['your-brevo-api-key'],
  MAIL_FROM: ['noreply@your-domain.com'],
  TELEGRAM_BOT_TOKEN: ['your-telegram-bot-token'],
  GEMINI_API_KEY: ['your-gemini-api-key'],
  GROQ_API_KEY: ['your-groq-api-key'],
};

/** Валидация критических env-переменных при старте.
 *  Цель: не дать приложению подняться с дефолтными или пустыми секретами.
 *  CRITICAL (refuse boot): JWT_SECRET, DATABASE_URL, CORS_ORIGINS, NODE_ENV.
 *  ADVISORY (log warning): остальные интеграции — без них фича не работает,
 *  но приложение поднимется. */
function assertSecurityCriticalEnv() {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ─── JWT_SECRET (critical) ──────────────────────────────────────────
  const secret = (process.env.JWT_SECRET || '').trim();
  if (!secret) {
    errors.push('JWT_SECRET is missing — set it to a random 64+ byte hex string');
  } else if (secret.length < 32) {
    errors.push(`JWT_SECRET is too short (${secret.length} chars) — minimum 32 (recommended 64+)`);
  } else if (/^(secret|change(-_)?me|test|dev|default|password|123|jwt[-_]?secret|CHANGE_THIS)/i.test(secret)) {
    errors.push('JWT_SECRET looks like a placeholder — generate a real random value');
  } else if (ENV_PLACEHOLDERS.JWT_SECRET.includes(secret)) {
    errors.push('JWT_SECRET equals the .env.example placeholder');
  }

  if (isProduction) {
    if (!process.env.DATABASE_URL) errors.push('DATABASE_URL is required in production');
    if (!process.env.CORS_ORIGINS) errors.push('CORS_ORIGINS must be set explicitly in production (no wildcard fallback)');
    if (process.env.NODE_ENV !== 'production') errors.push('NODE_ENV must be "production" in prod build');
  }

  // ─── Advisory: всё остальное (placeholder'ы интеграций) ─────────────
  // Эти не валят процесс — но в логах громко скажут, что интеграция «не настроена,
  // хотя env-переменная заполнена», чтобы не было сюрприза «почему telegram не шлёт».
  for (const [key, placeholders] of Object.entries(ENV_PLACEHOLDERS)) {
    if (key === 'JWT_SECRET' || key === 'DATABASE_URL') continue; // уже проверены выше как critical
    const value = (process.env[key] || '').trim();
    if (value && placeholders.includes(value)) {
      warnings.push(`${key} contains the .env.example placeholder value → integration will not work. Set a real value or remove the var entirely.`);
    }
  }

  // ─── CORS_ORIGINS: дополнительная проверка на localhost в проде ─────
  if (isProduction && process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map(o => o.trim());
    const hasLocalhost = origins.some(o => /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(o));
    if (hasLocalhost) {
      warnings.push(`CORS_ORIGINS includes localhost in production — remove dev origins from prod env`);
    }
    const hasWildcard = origins.some(o => o === '*');
    if (hasWildcard) {
      errors.push('CORS_ORIGINS contains "*" wildcard — break cookies + open CSRF. Use explicit URLs only.');
    }
  }

  if (warnings.length) {
    // eslint-disable-next-line no-console
    console.warn('\n⚠️  Security warnings (non-fatal):');
    for (const w of warnings) {
      // eslint-disable-next-line no-console
      console.warn(`  ⚠ ${w}`);
    }
    // eslint-disable-next-line no-console
    console.warn('');
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
  // Для unknown origin отдаём (null, false) — браузер просто не получит
  // Access-Control-Allow-Origin и заблокирует ответ сам. Никаких 500-ок
  // и шумных error-логов от нелегитимных origin'ов.
  app.enableCors({
    origin: (origin, cb) => {
      // origin === undefined → не браузерный запрос (curl, server-to-server)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
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

  // Swagger открывает всю поверхность API — какие endpoints, какие
  // DTO-поля принимаются, какие роли есть. В проде это информационная
  // утечка: атакующий получает полную карту атаки. Включить можно через
  // ENABLE_SWAGGER=true (например, временно для отладки).
  const enableSwagger = !isProduction || process.env.ENABLE_SWAGGER === 'true';
  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('ERP System API')
      .setDescription('Corporate ERP System REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // Используем warn-уровень для bootstrap-сообщений, чтобы они были видны
  // даже в production-конфиге Winston (level=warn). Это не ошибки —
  // просто гарантированно видимые «бэкенд жив, такой-то порт».
  bootstrapLogger.warn(`✅ Backend running on http://localhost:${port}`, 'Bootstrap');
  bootstrapLogger.warn(`📚 Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();
