import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'src/prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: '*', // Adjust CORS as needed
  },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private readonly prisma: PrismaService) {}

  // Handle connection
  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
    this.emitOngoingTimelines(client);
  }

  // Handle disconnection
  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  // Emit ongoing timelines immediately on connection
  private async emitOngoingTimelines(client: Socket) {
    const ongoingTimelines = await this.prisma.timeLine.findMany({
      where: { endTime: null },
      include: {
        locations: { orderBy: { createdAt: 'asc' } },
        Device: true,
      },
    });

    client.emit('realtimeMonitor', ongoingTimelines);
  }

  // Unified event handler for better scalability
  @SubscribeMessage('event')
  async handleEvent(client: Socket, data: { type: string; payload: any }) {
    switch (data.type) {
      case 'realtimeMonitor':
        await this.handleRealtimeMonitor(client);
        break;

      case 'timelineDetailRealtime':
        await this.handleTimelineDetailRealtime(client, data.payload);
        break;

      default:
        client.emit('error', { message: 'Invalid event type' });
        break;
    }
  }

  // Realtime monitor logic
  private async handleRealtimeMonitor(client: Socket) {
    const ongoingTimelines = await this.prisma.timeLine.findMany({
      where: { endTime: null },
      include: {
        locations: { orderBy: { createdAt: 'asc' } },
        Device: true,
      },
    });

    client.emit('realtimeMonitor', ongoingTimelines);
  }

  // Timeline detail realtime logic
  private async handleTimelineDetailRealtime(client: Socket, payload: { timelineId: string }) {
    const timeline = await this.prisma.timeLine.findUnique({
      where: { id: payload.timelineId },
      include: {
        locations: { orderBy: { createdAt: 'asc' } },
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

  // Location update logic
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
}
