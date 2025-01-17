import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT;

  app.enableCors({
    origin: '*',
  });

  // Use WebSocket adapter
  app.useWebSocketAdapter(new WsAdapter(app));

  // Start listening for connections
  await app.listen(port);
  console.log(`Application is running on port: ${port}`);
}
bootstrap();
