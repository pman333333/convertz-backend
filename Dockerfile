# Use Node.js 18 on Ubuntu base for better LibreOffice compatibility
FROM node:18-slim

# Set working directory
WORKDIR /app

# Install system dependencies including LibreOffice with enhanced configuration
RUN apt-get update && apt-get install -y \
    # FFmpeg for audio/video conversion
    ffmpeg \
    # LibreOffice and dependencies for document conversion
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    # Additional dependencies for LibreOffice headless operation
    default-jre-headless \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    # System utilities
    curl \
    wget \
    ca-certificates \
    # Clean up to reduce image size
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/* \
    && rm -rf /var/tmp/*

# Create necessary directories for LibreOffice
RUN mkdir -p /tmp/libreoffice \
    && mkdir -p /app/temp \
    && mkdir -p /app/uploads \
    && chmod -R 755 /tmp/libreoffice \
    && chmod -R 755 /app/temp \
    && chmod -R 755 /app/uploads

# Set environment variables for headless operation
ENV HOME=/tmp
ENV TMPDIR=/tmp
ENV DISPLAY=:99
ENV LIBGL_ALWAYS_SOFTWARE=1

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd -m -u 1001 appuser \
    && chown -R appuser:appuser /app \
    && chown -R appuser:appuser /tmp

# Switch to non-root user
USER appuser

# Test LibreOffice installation during build
RUN libreoffice --headless --version || echo "LibreOffice test failed but continuing..."

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

# Start the application
CMD ["node", "server.js"]
