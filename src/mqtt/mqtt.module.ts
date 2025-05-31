import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WebsocketModule } from 'src/websocket/websocket.module';

@Module({
  imports: [PrismaModule, WebsocketModule],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
