#!/bin/bash
set -e

# Set project ID
PROJECT_ID="fifiai"
REGION="asia-southeast2"
SERVICE_NAME="geo-tracking-service"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Load environment variables from .env file
echo "Loading environment variables from .env file..."
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
  echo "Database credentials loaded successfully."
else
  echo "Error: .env file not found."
  exit 1
fi

# Set up environment for deployment
echo "Setting up environment for deployment..."

# Set GCP project
gcloud config set project fifiai

# Check active account
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)")
echo "Using GCP account: $ACTIVE_ACCOUNT"

# Check if Artifact Registry repository exists
echo "Checking Artifact Registry repository..."
if ! gcloud artifacts repositories describe geo-tracking-repo --location=asia-southeast2 &>/dev/null; then
  echo "Artifact Registry repository not found or not accessible. Attempting to create..."
  gcloud artifacts repositories create geo-tracking-repo \
    --repository-format=docker \
    --location=asia-southeast2 \
    --description="Repository for geo-tracking services" || {
      echo "Failed to create repository. This may be due to permission issues."
      echo "Consider using GitHub Actions for deployment instead."
      echo "Do you want to continue anyway? (y/n)"
      read -r response
      if [[ "$response" != "y" ]]; then
        echo "Deployment aborted."
        exit 1
      fi
    }
fi

# Configure Docker to use GCP Artifact Registry
echo "Configuring Docker authentication for GCP Artifact Registry..."
gcloud auth configure-docker asia-southeast2-docker.pkg.dev --quiet

# Check if Cloud Build API is enabled
echo "Checking if Cloud Build API is enabled..."
if ! gcloud services list --enabled | grep -q cloudbuild.googleapis.com; then
  echo "Cloud Build API is not enabled. Enabling now..."
  gcloud services enable cloudbuild.googleapis.com || {
    echo "Failed to enable Cloud Build API. This may be due to permission issues."
    echo "Consider using GitHub Actions for deployment instead."
    echo "Do you want to continue anyway? (y/n)"
    read -r response
    if [[ "$response" != "y" ]]; then
      echo "Deployment aborted."
      exit 1
    fi
  }
fi

# Build image using Cloud Build to avoid local disk space issues
echo "Building image using Cloud Build..."
gcloud builds submit \
  --tag asia-southeast2-docker.pkg.dev/fifiai/geo-tracking-repo/geo-tracking-service:latest \
  --timeout=30m \
  . || {
    echo "Failed to build image using Cloud Build. This may be due to permission issues."
    echo "Consider using GitHub Actions for deployment instead."
    exit 1
  }

# Install Cloud SQL Proxy if not already installed
if ! command -v cloud_sql_proxy &> /dev/null; then
  echo "Installing Cloud SQL Proxy..."
  curl -o cloud_sql_proxy https://dl.google.com/cloudsql/cloud_sql_proxy_x64_linux
  chmod +x cloud_sql_proxy
  sudo mv cloud_sql_proxy /usr/local/bin/
fi

# Run Prisma migrations
echo "Running Prisma migrations..."

# Ensure Prisma CLI is installed
npm install --no-save prisma
npx prisma generate

# Set DATABASE_URL for migrations
export DATABASE_URL="postgresql://${CLOUDSQL_USER}:${CLOUDSQL_PASSWORD}@localhost/${CLOUDSQL_DATABASE}?schema=public"

# Start Cloud SQL Proxy in the background
echo "Starting Cloud SQL Proxy..."
cloud_sql_proxy -instances=fifiai:asia-southeast2:location-tracking=tcp:5432 &
PROXY_PID=$!

# Wait for proxy to start
sleep 10
echo "Cloud SQL Proxy started. Running migrations..."

# Run migrations
npx prisma migrate deploy

# Kill the proxy
kill $PROXY_PID
echo "Migrations completed successfully!"

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."

# Construct DATABASE_URL for Cloud SQL connection
DATABASE_URL="postgresql://${CLOUDSQL_USER}:${CLOUDSQL_PASSWORD}@localhost/${CLOUDSQL_DATABASE}?host=/cloudsql/fifiai:asia-southeast2:location-tracking"

# Set all environment variables for the service
gcloud run deploy geo-tracking-service \
  --image asia-southeast2-docker.pkg.dev/fifiai/geo-tracking-repo/geo-tracking-service:latest \
  --platform managed \
  --region asia-southeast2 \
  --allow-unauthenticated \
  --memory=512Mi \
  --cpu=1 \
  --max-instances=10 \
  --min-instances=0 \
  --port=3000 \
  --set-env-vars="NODE_ENV=production,DATABASE_URL=${DATABASE_URL},JWT_APP_SECRET=${JWT_APP_SECRET},JWT_CMS_SECRET=${JWT_CMS_SECRET},JWT_EXPIRED=${JWT_EXPIRED},JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET},JWT_REFRESH_EXPIRED=${JWT_REFRESH_EXPIRED},MQTT_BROKER_URL=${MQTT_BROKER_URL},MQTT_CLIENT_ID=${MQTT_CLIENT_ID},MQTT_USERNAME=${MQTT_USERNAME},MQTT_PASSWORD=${MQTT_PASSWORD},MQTT_TOPIC_LOCATION=${MQTT_TOPIC_LOCATION},MQTT_TOPIC_DEVICE_STATUS=${MQTT_TOPIC_DEVICE_STATUS},MQTT_TOPIC_COMMANDS=${MQTT_TOPIC_COMMANDS}" \
  --add-cloudsql-instances=fifiai:asia-southeast2:location-tracking \
  --quiet

echo "Deployment completed successfully!"
echo "Your service is now available at: $(gcloud run services describe geo-tracking-service --region=asia-southeast2 --format='value(status.url)')"
