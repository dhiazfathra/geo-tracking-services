import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Use WebSocket adapter
  app.useWebSocketAdapter(new WsAdapter(app));

  // Start listening for connections
  await app.listen(3000);
  console.log(`Application is running on: http://localhost:3000`);
}
bootstrap();
