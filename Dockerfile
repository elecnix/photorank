# Use an official Node runtime as the base image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY *.js *.html *.css manifest.json ./

# Expose the port the app runs on
EXPOSE 3001

# Create a volume for photos
VOLUME ["/app/photos"]

# Use PM2 to manage the application and auto-restart
RUN npm install pm2 -g

# Use PM2 to start the application with auto-restart
CMD ["pm2-runtime", "server.js"]
