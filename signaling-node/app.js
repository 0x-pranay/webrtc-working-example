const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);

let clients = {}; // active browser or device clients connected via SSE
let sessions = {}; // active webrtc sessions I think

// Helper function to send SSE messages
function sendEvent(clientId, event, data) {
  if (clients[clientId]) {
    clients[clientId].response.write(`event: ${event}\n`);
    clients[clientId].response.write(`data: ${JSON.stringify(data)}\n\n`);
  } else {
    console.log(`Client ${clientId} not found.`);
  }
}

// SSE endpoint
app.get("/sse-events/:sessionId/:peerId", (req, res) => {
  const { sessionId, peerId } = req.params;
  const clientId = `${sessionId}-${peerId}`;

  const headers = {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  };
  res.writeHead(200, headers);

  const newClient = {
    id: clientId,
    sessionId: sessionId,
    peerId: peerId,
    response: res,
  };

  clients[clientId] = newClient;

  console.log(`New SSE client connected: ${clientId}`);

  req.on("close", () => {
    console.log(`${clientId} Connection closed`);
    delete clients[clientId];

    // Clean up session if empty
    if (sessions[sessionId] && sessions[sessionId][peerId]) {
      delete sessions[sessionId][peerId];
      if (Object.keys(sessions[sessionId]).length === 0) {
        delete sessions[sessionId];
        console.log(`Session ${sessionId} cleaned up`);
      }
    }
  });

  // Send a ping to keep the connection alive
  setInterval(() => {
    sendEvent(clientId, "ping", { time: new Date() });
  }, 30000);
});

// Register endpoint
app.post("/register/:sessionId/:peerId", (req, res) => {
  const { sessionId, peerId } = req.params;
  const { clientType = "browser" } = req.body; // Expecting 'android' or 'browser'
  const clientId = `${sessionId}-${peerId}`;

  // creating an empty session if it doesn't exists
  if (!sessions[sessionId]) {
    sessions[sessionId] = {};
  }
  sessions[sessionId][peerId] = clientId;

  if (clientType === "android") {
    androidClients[clientId] = true;
    console.log(`Android peer ${peerId} registered to session ${sessionId}`);
  } else {
    console.log(`Browser peer ${peerId} registered to session ${sessionId}`);
  }

  // In-house notification (replace with your actual implementation)
  // This should notify other peers in the session about the new peer
  for (const otherPeerId in sessions[sessionId]) {
    if (otherPeerId !== peerId) {
      const otherClientId = sessions[sessionId][otherPeerId];
      if (androidClients[otherClientId]) {
        sendNotificationToDevice(otherClientId, {
          type: "new-peer",
          peerId: peerId,
          sessionId: sessionId,
        });
      } else {
        // Notify browser clients via SSE
        sendEvent(otherClientId, "new-peer", {
          peerId: peerId,
          sessionId: sessionId,
        });
      }
    }
  }

  res.status(200).send({ message: "Registered" });
});

// In-house notification function (replace with your actual implementation)
function sendNotificationToDevice(clientId, message) {
  // This is a placeholder - replace with your actual notification logic
  // e.g., sending a push notification, calling an API, etc.
  console.log(
    `Sending notification to ${clientId}: ${JSON.stringify(message)}`,
  );
}

// Forward offer, answer, or ICE candidate
app.post("/message/:sessionId/:peerId", (req, res) => {
  const { sessionId, peerId } = req.params;
  const { type, payload, target } = req.body;

  const targetPeerId = target;

  if (sessions[sessionId] && sessions[sessionId][targetPeerId]) {
    const targetClientId = sessions[sessionId][targetPeerId];

    if (androidClients[targetClientId]) {
      // Send notification to Android client
      sendNotificationToDevice(targetClientId, {
        type: type,
        data: payload,
        senderId: peerId,
      });
    } else {
      // Send SSE to browser client
      sendEvent(targetClientId, type, {
        data: payload,
        senderId: peerId,
      });
    }

    res.status(200).send({ message: "Message sent" });
  } else {
    console.log(
      `Target peer ${targetPeerId} not found in session ${sessionId}`,
    );
    res.status(404).send({ message: "Target peer not found" });
  }
});

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

  sendEventOld({ message: "Connected to SSE" });
  // Simulate updates every 5 seconds
  const intervalId = setInterval(() => {
    sendEventOld({ message: new Date().toLocaleTimeString() });
  }, 5000);

  request.on("close", () => {
    console.log(`${clientId} Connection closed`);
    clients = clients.filter((client) => client.id !== clientId);
    clearInterval(intervalId);
  });

  function sendEventOld(data) {
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
