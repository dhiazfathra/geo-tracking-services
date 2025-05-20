/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConfigService } from '@nestjs/config';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { EventType } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'src/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@WebSocketGateway({ cors: { origin: '*' } })
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() server: Server;

  private connectedClients: Map<string, { socket: Socket; lastActivity: Date; deviceId?: string }> = new Map();

  // Ping interval in milliseconds (default: 60 seconds)
  private pingInterval: number = 60000;
  private pingIntervalId: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    // Get ping interval from config or use default (60 seconds)
    const configInterval = this.configService.get<number>('PING_INTERVAL_SECONDS');
    if (configInterval) {
      this.pingInterval = configInterval * 1000; // Convert to milliseconds
    }
    console.log(`Ping interval set to ${this.pingInterval / 1000} seconds`);
  }

  afterInit(server: Server) {
    console.log('WebSocket Gateway initialized');
    this.startPingInterval();
  }

  private startPingInterval() {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
    }

    this.pingIntervalId = setInterval(() => {
      this.pingIdleClients();
    }, this.pingInterval);
  }

  private async pingIdleClients() {
    const now = new Date();
    console.log(`Checking for idle clients at ${now.toISOString()}`);

    for (const [clientId, clientInfo] of this.connectedClients.entries()) {
      const timeSinceLastActivity = now.getTime() - clientInfo.lastActivity.getTime();

      if (timeSinceLastActivity >= this.pingInterval) {
        console.log(`Pinging idle client ${clientId} (Device ID: ${clientInfo.deviceId || 'unknown'})`);

        try {
          clientInfo.socket.emit('ping', {
            timestamp: now.toISOString(),
            message: 'Are you still there?',
          });

          if (clientInfo.deviceId) {
            try {
              const timeline = await this.prisma.timeLine.findFirst({
                where: {
                  deviceId: clientInfo.deviceId,
                  endTime: null,
                },
              });

              const lastLocation = await this.prisma.location.findFirst({
                where: {
                  deviceId: clientInfo.deviceId,
                },
                orderBy: {
                  createdAt: 'desc',
                },
              });

              await this.prisma.location.create({
                data: {
                  deviceId: clientInfo.deviceId,
                  latitude: lastLocation?.latitude || 0,
                  longitude: lastLocation?.longitude || 0,
                  reverseData: lastLocation?.reverseData || 'Device idle',
                  eventType: EventType.IDLE,
                  timeLineId: timeline?.id || null,
                },
              });

              console.log(`IDLE event stored for device ${clientInfo.deviceId}`);
            } catch (dbError) {
              console.error(`Error storing IDLE event for device ${clientInfo.deviceId}:`, dbError);
            }
          }
        } catch (error) {
          console.error(`Error pinging client ${clientId}:`, error);
        }
      }
    }
  }

  // Handle connection
  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);

    this.connectedClients.set(client.id, {
      socket: client,
      lastActivity: new Date(),
    });
  }

  // Handle disconnection
  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.connectedClients.delete(client.id);
  }

  // Handle ping response from client
  @SubscribeMessage('pong')
  handlePong(client: Socket, data: any) {
    console.log(`Received pong from client ${client.id}:`, data);

    const clientInfo = this.connectedClients.get(client.id);
    if (clientInfo) {
      clientInfo.lastActivity = new Date();

      if (data && data.deviceId) {
        clientInfo.deviceId = data.deviceId;
      }
    }
  }

  @SubscribeMessage('locationUpdate')
  async handleLocationUpdate(client: Socket, data: any) {
    const { deviceName, os, latitude, longitude, reverseData, eventType } = data;
    let { deviceId } = data;

    // Log data yang diterima
    console.log('Received location update:');
    console.log('Data:', JSON.stringify(data, null, 2));

    const clientInfo = this.connectedClients.get(client.id);
    if (clientInfo) {
      clientInfo.lastActivity = new Date();
      if (deviceId) {
        clientInfo.deviceId = deviceId;
      }
    }

    // Validasi data utama
    if (!latitude || !longitude || !eventType) {
      console.error('Invalid data received:', { latitude, longitude, eventType });
      return { status: 'error', message: 'Invalid data received' };
    }

    // Generate deviceId jika undefined
    if (!deviceId) {
      deviceId = uuidv4();
      console.log(`Generated new deviceId: ${deviceId}`);
    }

    try {
      // Upsert untuk Device (create jika tidak ada, update jika ada)
      await this.prisma.device.upsert({
        where: { id: deviceId },
        update: { name: deviceName || 'Unknown Device', os: os || 'Unknown OS' },
        create: {
          id: deviceId,
          name: deviceName || 'Unknown Device',
          os: os || 'Unknown OS',
        },
      });
      console.log(`Device updated/created: ${deviceId}`);

      // Cari timeline aktif (endTime null)
      let timeline = await this.prisma.timeLine.findFirst({
        where: {
          deviceId,
          endTime: null,
        },
      });

      // Jika eventType START, buat timeline baru jika tidak ada
      if (eventType === 'START') {
        if (!timeline) {
          timeline = await this.prisma.timeLine.create({
            data: {
              deviceId,
              startTime: new Date(),
            },
          });
          console.log(`New timeline started for device ${deviceId}`);
        }
      }

      // Jika eventType FINISH, tutup timeline aktif
      else if (eventType === 'FINISH') {
        if (timeline) {
          await this.prisma.timeLine.update({
            where: { id: timeline.id },
            data: { endTime: new Date() },
          });
          console.log(`Timeline ended for device ${deviceId}`);
        }
      }

      // Insert data lokasi
      await this.prisma.location.create({
        data: {
          deviceId,
          latitude,
          longitude,
          reverseData: reverseData || 'Unknown',
          eventType,
          timeLineId: timeline?.id || null,
        },
      });
      console.log(`Location inserted for device ${deviceId}: (${latitude}, ${longitude})`);

      // Emit data terbaru ke client
      client.send('locationUpdate', {
        deviceId,
        latitude,
        longitude,
        reverseData,
      });

      console.log('Location update emitted to clients.');
    } catch (error) {
      console.error('Error handling location update:', error);
    }
  }

  @SubscribeMessage('activeTimeline')
  async timelineActive(client: Socket) {
    console.log('Event "activeTimeline" diterima');

    try {
      const data = await this.prisma.timeLine.findMany({
        where: {
          endTime: null,
        },
        include: { Device: true },
        orderBy: { createdAt: 'desc' },
      });

      if (data.length === 0) {
        const message = JSON.stringify({
          event: 'activeTimeline',
          message: 'No activity yet!!',
        });

        client.send(message);
        // this.server.clients.forEach((client: any) => {
        //   client.send(message);
        // });
      } else {
        const message = JSON.stringify({
          event: 'activeTimeline',
          data,
        });

        client.send(message);
        // this.server.clients.forEach((client: any) => {
        //   client.send(message);
        // });
      }
    } catch (error) {
      const errorMessage = JSON.stringify({
        event: 'activeTimeline',
        message: 'Failed to fetch ongoing timelines',
      });

      client.send(errorMessage);
      // this.server.clients.forEach((client: any) => {
      //   client.send(errorMessage);
      // });
    }
  }

  @SubscribeMessage('detailActivity')
  async detailActivity(client: Socket, data: any) {
    console.log('Event "detailActivity" diterima');
    console.log('Payload diterima:', data);

    try {
      const datas = await this.prisma.location.findMany({
        where: {
          timeLineId: data.timelineId,
        },

        orderBy: { createdAt: 'asc' },
      });
      const message = JSON.stringify({
        event: 'detailActivity',
        datas,
      });
      client.send(message);
    } catch (error) {
      const errorMessage = JSON.stringify({
        event: 'detailActivity',
        message: 'Failed to fetch detail timelines',
      });

      client.send(errorMessage);
    }
  }
}
