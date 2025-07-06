# Use Node.js 18 with system dependencies
FROM node:18-bullseye

# Install system dependencies for file conversion
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create directories for file processing
RUN mkdir -p uploads outputs

# Expose port
EXPOSE 3001

# Start the server
CMD ["npm", "start"]