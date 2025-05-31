import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { EventType } from '@prisma/client';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import { v4 as uuidv4 } from 'uuid';
import mqttConfig from './mqtt.config';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
  private readonly logger = new Logger(MqttService.name);
  private readonly mqttConfig: ReturnType<typeof mqttConfig>;
  private readonly topics: {
    locationUpdates: string;
    deviceStatus: string;
    commands: string;
  };
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly websocketGateway: WebsocketGateway,
  ) {
    // Get MQTT configuration
    this.mqttConfig = this.configService.get('mqtt') || mqttConfig();
    this.topics = this.mqttConfig.topics;
    
    this.logger.log(`MQTT configuration loaded: broker=${this.mqttConfig.broker}`);
  }

  onModuleInit() {
    this.connectToBroker();
  }

  onModuleDestroy() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.client) {
      this.client.end();
    }
  }
  
  /**
   * Schedules a reconnection attempt with exponential backoff
   */
  private scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      // Exponential backoff: 1s, 2s, 4s, 8s, etc. up to 2 minutes max
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 120000);
      
      this.logger.log(`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
      
      this.reconnectTimeout = setTimeout(() => {
        this.connectToBroker();
      }, delay);
    } else {
      this.logger.warn(`Maximum reconnect attempts (${this.maxReconnectAttempts}) reached. Stopping reconnect attempts.`);
    }
  }

  private connectToBroker() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.warn(`Maximum reconnect attempts (${this.maxReconnectAttempts}) reached. Stopping reconnect attempts.`);
      return;
    }
    
    this.logger.log(`Connecting to MQTT broker at ${this.mqttConfig.broker} (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
    
    try {
      const connectOptions: mqtt.IClientOptions = {
        clientId: this.mqttConfig.clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 0, // We'll handle reconnection manually
      };
      
      // Add authentication if provided
      if (this.mqttConfig.username && this.mqttConfig.password) {
        connectOptions.username = this.mqttConfig.username;
        connectOptions.password = this.mqttConfig.password;
      }
      
      this.client = mqtt.connect(this.mqttConfig.broker, connectOptions);

    this.client.on('connect', () => {
      this.logger.log('Connected to MQTT broker');
      
      // Subscribe to topics
      this.client.subscribe(this.topics.locationUpdates, { qos: 1 });
      this.client.subscribe(this.topics.deviceStatus, { qos: 1 });
      
      this.logger.log(`Subscribed to topics: ${Object.values(this.topics).join(', ')}`);
    });

    this.client.on('message', async (topic, payload) => {
      try {
        const message = JSON.parse(payload.toString());
        this.logger.log(`Received message on topic ${topic}: ${JSON.stringify(message)}`);
        
        if (topic === this.topics.locationUpdates) {
          await this.handleLocationUpdate(message);
        } else if (topic === this.topics.deviceStatus) {
          await this.handleDeviceStatus(message);
        }
      } catch (error) {
        this.logger.error(`Error processing MQTT message: ${error.message}`, error.stack);
      }
    });

    this.client.on('error', (error) => {
      this.logger.error(`MQTT client error: ${error.message}`, error.stack);
      this.scheduleReconnect();
    });

    this.client.on('disconnect', () => {
      this.logger.warn('Disconnected from MQTT broker');
      this.scheduleReconnect();
    });

    this.client.on('close', () => {
      this.logger.warn('MQTT connection closed');
      this.scheduleReconnect();
    });
    
    this.client.on('offline', () => {
      this.logger.warn('MQTT client is offline');
      this.scheduleReconnect();
    });
    } catch (error) {
      this.logger.error(`Error connecting to MQTT broker: ${error.message}`);
      this.scheduleReconnect();
    }
  }

  async handleLocationUpdate(data: any) {
    this.logger.log(`Received location update: ${JSON.stringify(data)}`);

    try {
      // Extract device information
      const { deviceId, deviceName, os, latitude, longitude, eventType, reverseData } = data;

      // Validate required fields
      if (!deviceId || !latitude || !longitude) {
        this.logger.error('Missing required fields in location update');
        return null;
      }

      // Upsert device information
      await this.prisma.device.upsert({
        where: { id: deviceId },
        update: {
          name: deviceName || `Device ${deviceId}`,
          os: os || 'Mobile',
        },
        create: {
          id: deviceId,
          name: deviceName || `Device ${deviceId}`,
          os: os || 'Mobile',
        },
      });

      // Handle timeline based on event type
      let timeline = await this.prisma.timeLine.findFirst({
        where: {
          deviceId,
          endTime: null,
        },
      });

      if (eventType === 'START') {
        if (!timeline) {
          timeline = await this.prisma.timeLine.create({
            data: {
              deviceId,
              startTime: new Date(),
            },
          });
          this.logger.log(`New timeline started for device ${deviceId}`);
        }
      } else if (eventType === 'FINISH') {
        if (timeline) {
          await this.prisma.timeLine.update({
            where: { id: timeline.id },
            data: { endTime: new Date() },
          });
          this.logger.log(`Timeline ended for device ${deviceId}`);
        }
      }

      // Store location in database
      const location = await this.prisma.location.create({
        data: {
          deviceId,
          latitude,
          longitude,
          reverseData: reverseData || 'Unknown',
          eventType: eventType as EventType,
          timeLineId: timeline?.id || null,
        },
      });

      // Create pointer object for broadcasting to WebSocket clients
      const pointer = {
        id: uuidv4(),
        deviceId,
        deviceName: deviceName || `Device ${deviceId}`,
        os: os || 'Mobile',
        latitude,
        longitude,
        timestamp: new Date().toISOString(),
      };

      // Broadcast to WebSocket clients
      this.logger.log(`Broadcasting location update to WebSocket clients: ${JSON.stringify(pointer)}`);
      this.websocketGateway.broadcastLocationUpdate(pointer);

      return location;
    } catch (error) {
      this.logger.error(`Error handling location update: ${error.message}`, error.stack);
      throw error;
    }
  }

  async handleDeviceStatus(data: any) {
    const { deviceId, status, timestamp } = data;
    
    this.logger.log(`Device ${deviceId} status update: ${status}`);
    
    // You can implement device status tracking here if needed
    // For example, storing online/offline status in the database
  }

  // Method to publish messages to MQTT topics
  publishMessage(topic: string, message: any) {
    if (!this.client || !this.client.connected) {
      this.logger.warn(`Cannot publish message to ${topic}: MQTT client not connected`);
      return false;
    }

    try {
      this.logger.log(`Publishing message to ${topic}: ${JSON.stringify(message)}`);
      this.client.publish(topic, JSON.stringify(message));
      return true;
    } catch (error) {
      this.logger.error(`Error publishing message to ${topic}: ${error.message}`, error.stack);
      return false;
    }
  }

  // Send command to a specific device
  sendCommandToDevice(deviceId: string, command: string, data: any) {
    const topic = `${this.topics.commands}/${deviceId}`;
    const payload = {
      deviceId,
      command,
      data,
      timestamp: new Date(),
    };

    return this.publishMessage(topic, payload);
  }
}
