#!/bin/bash

# Script to add all environment variables from .env file as GitHub repository secrets
# Usage: ./add-github-secrets.sh

# Check if .env file exists
if [ ! -f ../.env ] && [ ! -f ./.env ]; then
  echo "Error: .env file not found!"
  exit 1
fi

# Determine the path to .env file
ENV_FILE="./.env"
if [ ! -f "$ENV_FILE" ] && [ -f "../.env" ]; then
  ENV_FILE="../.env"
fi

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
  echo "Error: GitHub CLI (gh) is not installed. Please install it first."
  exit 1
fi

echo "Adding GitHub repository secrets from .env file..."

# Read .env file line by line
while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip empty lines and comments
  if [[ -z "$line" || "$line" =~ ^\s*# ]]; then
    continue
  fi
  
  # Extract variable name and value
  if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
    name="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    
    # Remove quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    
    # Add secret to GitHub repository
    echo "Adding secret: $name"
    gh secret set "$name" --body "$value" -R dhiazfathra/geo-tracking-services
  fi
done < "$ENV_FILE"

echo "All secrets have been added successfully!"
