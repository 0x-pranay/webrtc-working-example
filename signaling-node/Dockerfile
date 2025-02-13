# # Set up signaling node server at localhost:9999 
# FROM node:alphine
# EXPOSE 9999
# RUN mkdir /signaling
# COPY ./ /signaling
# WORKDIR /signaling/
# RUN npm install express socket.io mediasoup
# CMD node server.js & sleep infinity 
# To watch the local files and restart the server


# Use a lightweight Alpine-based Node.js image
FROM node:22-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install dependencies
RUN yarn install --production --silent 

# Copy the rest of the application code to the working directory
# COPY . .

# Expose the port the app will run on
EXPOSE 8080

# Command to start the node application
CMD [ "node", "app.js"]
