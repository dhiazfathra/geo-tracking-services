#!/bin/bash

# Script to set up GCP Artifact Registry for Cloud Run deployment

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed. Please install it first."
    echo "Visit: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Prompt for GCP project ID
read -p "Enter your GCP Project ID: " PROJECT_ID

# Prompt for GCP region
read -p "Enter your GCP Region (e.g., us-central1): " REGION

# Ensure user is logged in
echo "Ensuring you're logged into GCP..."
gcloud auth login

# Set the current project
echo "Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "Enabling required GCP APIs..."
gcloud services enable artifactregistry.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# Create Artifact Registry repository
echo "Creating Artifact Registry repository..."
gcloud artifacts repositories create geo-tracking-repo \
    --repository-format=docker \
    --location=$REGION \
    --description="Docker repository for Geo Tracking Services"

# Create service account for GitHub Actions
echo "Creating service account for GitHub Actions..."
gcloud iam service-accounts create github-actions-deployer \
    --display-name="GitHub Actions Deployer"

# Grant required roles to the service account
echo "Granting required roles to the service account..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-deployer@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Create and download service account key
echo "Creating service account key..."
gcloud iam service-accounts keys create gcp-key.json \
    --iam-account=github-actions-deployer@$PROJECT_ID.iam.gserviceaccount.com

echo "============================================================"
echo "Setup complete! Here's what you need to do next:"
echo "1. Add the following secrets to your GitHub repository:"
echo "   - GCP_PROJECT_ID: $PROJECT_ID"
echo "   - GCP_REGION: $REGION"
echo "   - GCP_SA_KEY: The contents of the gcp-key.json file"
echo "2. Add your application secrets to GitHub repository secrets"
echo "3. Keep the gcp-key.json file secure and do not commit it to your repository"
echo "============================================================"
