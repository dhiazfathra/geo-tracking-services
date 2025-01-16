import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebsocketModule } from './websocket/websocket.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [WebsocketModule, PrismaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
