import { registerAs } from '@nestjs/config';

export default registerAs('mqtt', () => ({
  // Use a public MQTT broker for testing
  // HiveMQ public broker: mqtt://broker.hivemq.com:1883
  // EMQ X public broker: mqtt://broker.emqx.io:1883
  broker: process.env.MQTT_BROKER_URL || 'mqtt://broker.emqx.io:1883',
  clientId: process.env.MQTT_CLIENT_ID || `geo-tracking-service-${Math.random().toString(16).substring(2, 10)}`,
  username: process.env.MQTT_USERNAME || '',
  password: process.env.MQTT_PASSWORD || '',
  topics: {
    // Use a unique prefix for your topics to avoid conflicts with other users
    locationUpdates: process.env.MQTT_TOPIC_LOCATION || 'geo-tracking/location',
    deviceStatus: process.env.MQTT_TOPIC_DEVICE_STATUS || 'geo-tracking/device/status',
    commands: process.env.MQTT_TOPIC_COMMANDS || 'geo-tracking/commands',
  },
}));
