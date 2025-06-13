#!/bin/bash

# Script to test the Docker setup locally before deploying to Cloud Run

# Check if .env file exists, if not create one with default values
if [ ! -f ".env" ]; then
    echo "No .env file found, creating one with default values..."
    cp .env.example .env
    echo "Created .env file from .env.example"
fi

# Build the Docker image
echo "Building Docker image..."
docker build -t geo-tracking-service:local .

# Run the Docker image locally
echo "Running Docker image locally..."
docker run -p 3000:3000 --env-file .env geo-tracking-service:local

echo "Container is running at http://localhost:3000"
echo "Press Ctrl+C to stop the container"
