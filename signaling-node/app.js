const express = require("express");
const http = require("http");
// const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);

let clients = [];
let sessions = {};

function eventsHandler(request, response, next) {
  const headers = {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  };
  response.writeHead(200, headers);

  const data = `data: ${JSON.stringify(facts)}\n\n`;

  response.write(data);

  // const clientId = Date.now();

  const { clientId, fleetId, userId, deviceId } = request.query;

  const newClient = {
    clientId,
    fleetId,
    userId,
    deviceId,
    response,
  };

  clients.push(newClient);

  sendEvent({ message: "Connected to SSE" });
  // Simulate updates every 5 seconds
  const intervalId = setInterval(() => {
    sendEvent({ message: new Date().toLocaleTimeString() });
  }, 5000);

  request.on("close", () => {
    console.log(`${clientId} Connection closed`);
    clients = clients.filter((client) => client.id !== clientId);
    clearInterval(intervalId);
  });

  function sendEvent(data) {
    return response.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

function sendSSEEvent({ target, data }) {
  // For the first time send pushy notification to device to initiate a sse connection.
  // Once an sse connection exists for that device, send the data to that device using sse.
  const { clientId, fleetId, userId, deviceId } = target;
  const client = clients.find(
    (client) =>
      client.clientId === clientId &&
      client.fleetId === fleetId &&
      (client.userId === userId || client.deviceId === deviceId),
  );
  if (client) {
    client.response.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

async function sendOffer(request, response) {
  const { target, caller, sdp } = request.body;
  await sendSSEEvent({ target, data: { caller, sdp } });
  response.json({ message: "Offer sent" });
}

app.post("/events", eventsHandler);

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Signaling server running on port ${port}`);
});
