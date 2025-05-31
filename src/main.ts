import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  let port = parseInt(process.env.PORT || '3000', 10);

  app.enableCors({
    origin: '*',
  });

  // Use WebSocket adapter with proper configuration
  const wsAdapter = new WsAdapter(app);
  app.useWebSocketAdapter(wsAdapter);
  
  // Log WebSocket adapter initialization
  console.log('WebSocket adapter initialized');

  const config = new DocumentBuilder()
    .setTitle('Geo Tracking API')
    .setDescription('API documentation for Geo Tracking Services')
    .setVersion('1.0')
    .addTag('geo-tracking')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Function to try listening on a port and increment if it's in use
  const startServer = async (attemptPort: number): Promise<number> => {
    try {
      await app.listen(attemptPort);
      return attemptPort;
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        console.log(`Port ${attemptPort} is already in use, trying ${attemptPort + 1}...`);
        return startServer(attemptPort + 1);
      }
      throw error;
    }
  };

  // Start listening for connections with auto port increment
  const usedPort = await startServer(port);
  console.log(`Application is running on port: ${usedPort}`);
}
bootstrap();
