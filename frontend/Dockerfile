# Use official Node.js image as base
FROM node:22-alpine AS build

ARG VITE_CLINIC_TIME_ZONE=Africa/Khartoum
ENV VITE_CLINIC_TIME_ZONE=${VITE_CLINIC_TIME_ZONE}

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application files
COPY . .

RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
