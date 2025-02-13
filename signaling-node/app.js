const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const rooms = {}; // Store room information
let clients = [];
let facts = ["hello"];

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

app.post("/send-offer", sendOffer);
//
// app.post("/send-answer", sendAnswer);

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join-room", (roomID) => {
    console.log({ event: "join-room", roomID });
    if (rooms[roomID]) {
      rooms[roomID].push(socket.id);
    } else {
      rooms[roomID] = [socket.id];
    }

    const otherUser = rooms[roomID].find((id) => id !== socket.id);
    if (otherUser) {
      socket.emit("other-user", otherUser);
      socket.to(otherUser).emit("user-joined", socket.id);
    }

    rooms[roomID].forEach((id) => {
      io.to(id).emit("user-connected", socket.id);
    });
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomID = Object.keys(rooms).find((key) =>
      rooms[key].includes(socket.id),
    );
    if (roomID) {
      rooms[roomID] = rooms[roomID].filter((id) => id !== socket.id);
      rooms[roomID].forEach((id) => {
        io.to(id).emit("user-disconnected", socket.id);
      });
    }
  });

  socket.on("offer", (payload) => {
    console.log({ eventType: "offer", payload });
    io.to(payload.target).emit("offer", payload);
  });

  socket.on("answer", (payload) => {
    console.log({ eventType: "answer", payload });
    io.to(payload.target).emit("answer", payload);
  });

  socket.on("ice-candidate", (incoming) => {
    console.log({ eventType: "ice-candidate", incoming });
    io.to(incoming.target).emit("ice-candidate", incoming);
  });
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Signaling server running on port ${port}`);
});
