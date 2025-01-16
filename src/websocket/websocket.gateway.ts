import { SubscribeMessage, WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway()
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private prisma: PrismaService) {}

  async handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('locationUpdate')
  async handleLocationUpdate(client: Socket, data: any) {
    const { deviceId, deviceName, model, os, latitude, longitude, reverseData } = data;
    console.log('Received data:', data);

    // Upsert device info
    await this.prisma.device.upsert({
      where: { id: deviceId },
      update: { name: deviceName, model, os },
      create: { id: deviceId, name: deviceName, model, os },
    });

    // Store location
    await this.prisma.location.create({
      data: {
        deviceId,
        latitude,
        longitude,
        reverseData,
      },
    });

    // Broadcast the update to all clients
    this.server.emit('locationUpdate', {
      deviceId,
      latitude,
      longitude,

      reverseData,
    });
  }
}
