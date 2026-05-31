#!/bin/bash
set -e

# ==============================================================================
# AWS Lightsail Database Deployment Script
# Run this script on your fresh $3.50/mo Ubuntu 24.04 Lightsail instance
# ==============================================================================

echo "🚀 Setting up AWS Lightsail Database Server..."

# 1. Update system and install Docker
echo "📦 Installing Docker..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2. Setup firewall (UFW)
echo "🛡️ Configuring Firewall (UFW)..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh

# IMPORTANT: Replace these with your actual Cloud Run Static IPs or VPC Connector IPs!
# For now, we will allow port 5432 so you can test it, but in production you should 
# ONLY allow the IP addresses of your Google Cloud Run services.
sudo ufw allow 5432/tcp

echo "y" | sudo ufw enable

# 3. Prompt for DB Password
read -p "Enter a strong password for the PostgreSQL 'postgres' user: " DB_PASSWORD

# 4. Create .env file for docker-compose
cat <<EOF > .env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_DB=demosage
EOF

echo "🐳 Starting PostgreSQL container..."
sudo docker compose up -d

echo "✅ Deployment complete!"
echo "Your DATABASE_URL for Vercel/Cloud Run is:"
echo "postgresql://postgres:$DB_PASSWORD@<YOUR_LIGHTSAIL_IP>:5432/demosage"
