import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { CONSOLE_COLORS } from 'colors.constants';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { envs } from './config/envs';

async function bootstrap() {

  const logger = new Logger(`${CONSOLE_COLORS.TEXT.MAGENTA}Orders-MS`);

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule,{
    transport: Transport.NATS,
    options: {
      servers: envs.natsServers,
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen();

  logger.log(`${CONSOLE_COLORS.STYLE.UNDERSCORE}${CONSOLE_COLORS.TEXT.CYAN}Orders-MS${CONSOLE_COLORS.TEXT.MAGENTA} is running on ${envs.port}`);
}
bootstrap();
