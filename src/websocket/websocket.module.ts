import { Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [WebsocketGateway],
  exports: [WebsocketGateway], // Export WebsocketGateway to be used by other modules
})
export class WebsocketModule {}
