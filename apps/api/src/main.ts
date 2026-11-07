import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Request, Response } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((item) => item.trim())
      : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  });

  app.use((req: Request, res: Response, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      // Lightweight access log for debugging request flow.
      console.log(
        `[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`,
      );
    });
    next();
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
