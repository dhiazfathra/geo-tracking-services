/* eslint-disable @typescript-eslint/no-unused-vars */
import { ConfigService } from '@nestjs/config';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { EventType } from '../common/types';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

// Define pointer interface for location data
export interface Pointer {
  id: string;
  deviceId: string;
  deviceName: string;
  os: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() server: Server;

  private connectedClients: Map<string, { socket: Socket; lastActivity: Date; deviceId?: string }> = new Map();

  // Ping interval in milliseconds (default: 1 hour = 3600000 ms)
  private pingInterval: number = 3600000;
  private pingIntervalId: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    // Get ping interval from config or use default (1 hour)
    const configInterval = this.configService.get<number>('PING_INTERVAL_SECONDS');
    if (configInterval) {
      this.pingInterval = configInterval * 1000; // Convert to milliseconds
    }
    console.log(`Idle check interval set to ${this.pingInterval / 1000} seconds (${this.pingInterval / 3600000} hours)`);
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
        console.log(`Detected idle client ${clientId} (Device ID: ${clientInfo.deviceId || 'unknown'})`);

        try {
          if (clientInfo.deviceId) {
            try {
              // Find active timeline
              const timeline = await this.prisma.timeLine.findFirst({
                where: {
                  deviceId: clientInfo.deviceId,
                  endTime: null,
                },
              });

              // Get last known location
              const lastLocation = await this.prisma.location.findFirst({
                where: {
                  deviceId: clientInfo.deviceId,
                },
                orderBy: {
                  createdAt: 'desc',
                },
              });

              // Create FINISH event
              await this.prisma.location.create({
                data: {
                  deviceId: clientInfo.deviceId,
                  latitude: lastLocation?.latitude || 0,
                  longitude: lastLocation?.longitude || 0,
                  reverseData: lastLocation?.reverseData || 'Tracking ended due to inactivity',
                  eventType: EventType.FINISH,
                  timeLineId: timeline?.id || null,
                },
              });

              // Close the timeline if it exists
              if (timeline) {
                await this.prisma.timeLine.update({
                  where: { id: timeline.id },
                  data: { endTime: new Date() },
                });
                console.log(`Timeline ended for device ${clientInfo.deviceId}`);
              }

              console.log(`FINISH event stored for device ${clientInfo.deviceId}`);

              // Notify client before disconnecting
              clientInfo.socket.emit('trackingEnded', {
                timestamp: now.toISOString(),
                message: 'Tracking ended due to inactivity',
                deviceId: clientInfo.deviceId,
              });
            } catch (dbError) {
              console.error(`Error storing FINISH event for device ${clientInfo.deviceId}:`, dbError);
            }
          }

          // Close the connection
          try {
            console.log(`Closing connection for idle client ${clientId}`);
            // Use the proper Socket.IO disconnect method
            if (clientInfo.socket) {
              // Tell the client we're disconnecting them
              clientInfo.socket.emit('forceDisconnect', {
                reason: 'Inactive session terminated',
                timestamp: new Date().toISOString(),
              });

              // Server-side disconnect
              clientInfo.socket.disconnect();
            }
            // Remove from our connected clients map
            this.connectedClients.delete(clientId);
          } catch (disconnectError) {
            console.error(`Error disconnecting client ${clientId}:`, disconnectError);
            // Still try to remove from map even if disconnect fails
            this.connectedClients.delete(clientId);
          }
        } catch (error) {
          console.error(`Error handling idle client ${clientId}:`, error);
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

    // Send welcome message to client
    client.emit('connected', {
      timestamp: new Date().toISOString(),
      message: 'Connected to tracking server',
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

      // Jika eventType START, buat timeline baru jika tidak ada atau jika timeline sebelumnya sudah ditutup
      if (eventType === 'START') {
        // Check if the device has any active timeline
        if (!timeline) {
          // Create a new timeline
          timeline = await this.prisma.timeLine.create({
            data: {
              deviceId,
              startTime: new Date(),
            },
          });
          console.log(`New timeline started for device ${deviceId}`);
        } else {
          console.log(`Device ${deviceId} already has an active timeline: ${timeline.id}`);
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

      // Create pointer object for broadcasting
      const pointer: Pointer = {
        id: uuidv4(),
        deviceId,
        deviceName: deviceName || 'Unknown Device',
        os: os || 'Unknown OS',
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
      };

      // Broadcast to all connected WebSocket clients
      this.broadcastLocationUpdate(pointer);

      console.log('Location update emitted to clients.');
    } catch (error) {
      console.error('Error handling location update:', error);
    }
  }
  
  /**
   * Broadcasts a location update to all connected WebSocket clients
   * This method can be called from the MQTT service to forward location updates
   * received via MQTT to WebSocket clients
   * 
   * @param pointer The pointer data to broadcast
   */
  broadcastLocationUpdate(pointer: Pointer) {
    try {
      console.log(`Broadcasting location update for device ${pointer.deviceId}`);
      
      // Check if this device already has a pointer
      this.prisma.location.findMany({
        where: { deviceId: pointer.deviceId },
        orderBy: { createdAt: 'desc' },
        take: 2,
      }).then(locations => {
        // If this is the first location for this device, emit pointerAdded
        if (locations.length <= 1) {
          console.log(`New device detected: ${pointer.deviceId}. Emitting pointerAdded event.`);
          
          // Send in Socket.IO format
          this.server.emit('pointerAdded', pointer);
          
          // Also send in WebSocket format
          this.connectedClients.forEach((clientInfo) => {
            if (clientInfo.socket) {
              clientInfo.socket.send(JSON.stringify({
                event: 'pointerAdded',
                data: pointer
              }));
            }
          });
        } else {
          // Otherwise, emit pointerMoved
          console.log(`Existing device moved: ${pointer.deviceId}. Emitting pointerMoved event.`);
          
          // Send in Socket.IO format
          this.server.emit('pointerMoved', pointer);
          
          // Also send in WebSocket format
          this.connectedClients.forEach((clientInfo) => {
            if (clientInfo.socket) {
              clientInfo.socket.send(JSON.stringify({
                event: 'pointerMoved',
                data: pointer
              }));
            }
          });
        }
        
        // Also emit all current pointers to ensure clients have the latest data
        this.getAllPointers().then(pointers => {
          // Send in Socket.IO format
          this.server.emit('pointers', pointers);
          
          // Also send in WebSocket format
          this.connectedClients.forEach((clientInfo) => {
            if (clientInfo.socket) {
              clientInfo.socket.send(JSON.stringify({
                event: 'pointers',
                data: pointers
              }));
            }
          });
        });
        
        // Also notify about the specific device update (for compatibility)
        this.server.emit('locationUpdate', {
          deviceId: pointer.deviceId,
          latitude: pointer.latitude,
          longitude: pointer.longitude,
        });
      }).catch(error => {
        console.error('Error checking device history:', error);
      });
    } catch (error) {
      console.error('Error broadcasting location update:', error);
    }
  }
  
  /**
   * Gets all active pointers based on the most recent location for each device
   * @returns Promise<Pointer[]> Array of pointers
   */
  private async getAllPointers(): Promise<Pointer[]> {
    try {
      // Get the most recent location for each device
      const devices = await this.prisma.device.findMany();
      const pointers: Pointer[] = [];
      
      for (const device of devices) {
        const latestLocation = await this.prisma.location.findFirst({
          where: { deviceId: device.id },
          orderBy: { createdAt: 'desc' },
        });
        
        if (latestLocation) {
          pointers.push({
            id: uuidv4(), // Generate a unique ID for this pointer
            deviceId: device.id,
            deviceName: device.name || `Device ${device.id}`,
            os: device.os || 'Unknown',
            latitude: latestLocation.latitude,
            longitude: latestLocation.longitude,
            timestamp: latestLocation.createdAt.toISOString(),
          });
        }
      }
      
      return pointers;
    } catch (error) {
      console.error('Error getting all pointers:', error);
      return [];
    }
  }

  @SubscribeMessage('getPointers')
  async handleGetPointers(client: Socket) {
    console.log(`Client ${client.id} requested all pointers`);
    
    try {
      const pointers = await this.getAllPointers();
      // Send the pointers to the client that requested them
      client.emit('pointers', pointers);
      
      // Also send a message in the format expected by the client
      const message = JSON.stringify({
        event: 'pointers',
        data: pointers
      });
      client.send(message);
      
      console.log(`Sent ${pointers.length} pointers to client ${client.id}`);
    } catch (error) {
      console.error('Error handling getPointers request:', error);
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
