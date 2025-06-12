# GitHub Actions Setup Guide

This document explains how to set up GitHub Actions for deploying the Geo Tracking Service to Google Cloud Run with Cloud SQL integration.

## Required GitHub Secrets

You need to add the following secrets to your GitHub repository:

### Google Cloud Platform Secrets

| Secret Name | Description | How to Obtain |
|-------------|-------------|---------------|
| `GCP_PROJECT_ID` | Your Google Cloud Project ID | From Google Cloud Console |
| `GCP_REGION` | The GCP region (e.g., `asia-southeast2`) | From Google Cloud Console |
| `GCP_SA_KEY` | Service Account JSON key | See instructions below |

### Database Secrets

| Secret Name | Description |
|-------------|-------------|
| `CLOUDSQL_USER` | Cloud SQL database username |
| `CLOUDSQL_PASSWORD` | Cloud SQL database password |
| `CLOUDSQL_DATABASE` | Cloud SQL database name |
| `CLOUDSQL_INSTANCE_NAME` | Full instance name (e.g., `project-id:region:instance-name`) |

### Application Secrets

| Secret Name | Description |
|-------------|-------------|
| `HOST` | Host URL |
| `JWT_APP_SECRET` | JWT secret for app authentication |
| `JWT_CMS_SECRET` | JWT secret for CMS authentication |
| `JWT_EXPIRED` | JWT expiration time |
| `JWT_REFRESH_SECRET` | JWT refresh token secret |
| `JWT_REFRESH_EXPIRED` | JWT refresh token expiration |
| `PING_INTERVAL_SECONDS` | Ping interval in seconds |

### MQTT Secrets

| Secret Name | Description |
|-------------|-------------|
| `MQTT_BROKER_URL` | MQTT broker URL |
| `MQTT_CLIENT_ID` | MQTT client ID |
| `MQTT_USERNAME` | MQTT username |
| `MQTT_PASSWORD` | MQTT password |
| `MQTT_TOPIC_LOCATION` | MQTT topic for location updates |
| `MQTT_TOPIC_DEVICE_STATUS` | MQTT topic for device status |
| `MQTT_TOPIC_COMMANDS` | MQTT topic for commands |

## Creating a Google Cloud Service Account Key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "IAM & Admin" > "Service Accounts"
3. Create a new service account or select an existing one
4. Grant the following roles:
   - Cloud Run Admin
   - Cloud SQL Admin
   - Storage Admin
   - Artifact Registry Admin
5. Create a new JSON key for this service account
6. Download the JSON key file

## Adding Secrets to GitHub

### Method 1: Using the GitHub Web Interface

1. Go to your GitHub repository
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"
4. Add each secret with its name and value

### Method 2: Using the GitHub CLI

You can use our provided script to add all secrets from your `.env` file:

```bash
# Make the script executable
chmod +x ./scripts/add-github-secrets.sh

# Run the script
./scripts/add-github-secrets.sh
```

For the `GCP_SA_KEY`, you need to add the entire contents of the JSON key file:

```bash
# Add the GCP service account key
gh secret set GCP_SA_KEY < path/to/your-service-account-key.json
```

## Troubleshooting

If you encounter the error:

```
Error: google-github-actions/auth failed with: the GitHub Action workflow must specify exactly one of "workload_identity_provider" or "credentials_json"!
```

Make sure:
1. The `GCP_SA_KEY` secret is properly set with the entire JSON content of your service account key
2. The secret is accessible to the workflow (secrets are not passed to workflows triggered from forks by default)
