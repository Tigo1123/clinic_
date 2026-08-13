# Use official Node.js image as base
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application files
COPY . .

# Expose port 5173
EXPOSE 5173

# Start development server
CMD ["npm", "run", "dev"]
