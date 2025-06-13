#!/bin/bash
set -e

# Check if secrets directory exists
if [ ! -d "./secrets" ]; then
  echo "Error: secrets directory not found. Please create it and add your cloudsql-client-key.json file."
  exit 1
fi

# Check if cloud SQL key exists
if [ ! -f "./secrets/cloudsql-client-key.json" ]; then
  echo "Error: Cloud SQL key file not found at ./secrets/cloudsql-client-key.json"
  exit 1
fi

# Stop any existing services
echo "Stopping any existing services..."
docker-compose down

# Start the Cloud SQL Proxy service first
echo "Starting Cloud SQL Proxy service..."
docker-compose up -d cloudsql-proxy

# Wait for Cloud SQL Proxy to be ready
echo "Waiting for Cloud SQL Proxy to be ready..."
MAX_RETRIES=30
COUNT=0
while ! docker-compose logs cloudsql-proxy | grep -q "ready for new connections"; do
  sleep 2
  COUNT=$((COUNT+1))
  if [ $COUNT -ge $MAX_RETRIES ]; then
    echo "Error: Cloud SQL Proxy failed to start properly after 60 seconds."
    docker-compose logs cloudsql-proxy
    docker-compose down
    exit 1
  fi
  echo "Waiting for Cloud SQL Proxy to be ready... ($COUNT/$MAX_RETRIES)"
done

# Run Prisma migrations before starting the API service
echo "Running Prisma migrations..."
docker-compose run --rm api npx prisma migrate deploy

# Start the remaining services
echo "Cloud SQL Proxy is ready! Starting remaining services..."
docker-compose up -d

echo "Services are running! Your application should be available at http://localhost:3000"
echo "To view logs, run: docker-compose logs -f"
echo "To stop services, run: docker-compose down"
