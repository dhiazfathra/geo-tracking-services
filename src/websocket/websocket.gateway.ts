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
    const { deviceId, deviceName, os, latitude, longitude, reverseData, eventType } = data;

    console.log('Received data:', data);

    // Upsert device info
    await this.prisma.device.upsert({
      where: { id: deviceId },
      update: { name: deviceName, os },
      create: { id: deviceId, name: deviceName, os },
    });

    // Handle timeline events
    let timeline = await this.prisma.timeLine.findFirst({
      where: {
        deviceId,
        endTime: null, // Check for active timeline
      },
    });

    if (eventType === 'START') {
      // If START event and no active timeline, create a new one
      if (!timeline) {
        timeline = await this.prisma.timeLine.create({
          data: {
            deviceId,
            startTime: new Date(),
          },
        });
        console.log(`New timeline started for device ${deviceId}`);
      }
    } else if (eventType === 'FINISH') {
      // If FINISH event, close the current timeline
      if (timeline) {
        await this.prisma.timeLine.update({
          where: { id: timeline.id },
          data: { endTime: new Date() },
        });
        console.log(`Timeline ended for device ${deviceId}`);
      }
    }

    // Store location data with timeline association
    await this.prisma.location.create({
      data: {
        deviceId,
        latitude,
        longitude,
        reverseData,
        eventType,
        timeLineId: timeline?.id || null, // Associate with active timeline if available
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

  @SubscribeMessage('realtimeMonitor')
  async handleRealtimeMonitor(client: Socket) {
    const ongoingTimelines = await this.prisma.timeLine.findMany({
      where: {
        endTime: null,
      },
      include: {
        locations: {
          orderBy: { createdAt: 'asc' },
        },
        Device: true,
      },
    });

    client.emit('realtimeMonitor', ongoingTimelines);
  }

  @SubscribeMessage('timelineDetailRealtime')
  async handleRealtimeTimelineDetail(client: Socket, data: { timelineId: string }) {
    const timeline = await this.prisma.timeLine.findUnique({
      where: { id: data.timelineId },
      include: {
        locations: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!timeline) {
      client.emit('timelineDetailRealtime', { error: 'Timeline not found' });
      return;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: timeline.deviceId },
    });

    client.emit('timelineDetailRealtime', {
      ...timeline,
      device,
    });
  }
}
