const express = require("express");
const http = require("http");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const bodyParser = require("body-parser");
const https = require("https");
const winston = require("winston");
const reqLogger = require("express-request-logger");

const app = express();
app.use(cors());
app.use(bodyParser.json()); // for parsing application/json

// request logger
// const logger = new winston.Logger({
//   transports: [
//     // new winston.transports.Console(),
//     new winston.transports.File({ filename: "httpLogs.log" }),
//   ],
// });

// app.use(reqLogger.create(logger, {}));

const httpsAgent = new https.Agent({
  family: 4, // Force IPv4
});

const server = http.createServer(app);

let clients = {}; // active browser or device clients connected via SSE
let sessions = {}; // active webrtc sessions I think
let androidClients = {}; // active android clients

// Cloudflare TURN configuration (replace with your actual values)
const TURN_KEY_ID = "7341540480fe621fc4e6267e9a55ec49";
const TURN_KEY_API_TOKEN =
  "b67ff493c47f78b89133bd1e3d6cb1aad05b9d21751256e75336534905f6e74c";

app.use(express.static(path.join(__dirname, "www")));

// GET endpoint to return ICE servers
app.get("/iceServers", async (req, res) => {
  try {
    // Call the Cloudflare TURN API to generate credentials
    const response = await axios.post(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate`,
      { ttl: 86400 },
      {
        headers: {
          Authorization: `Bearer ${TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        httpsAgent,
      },
    );
    if (response.status === 201 || response.status === 200) {
      // console.log(response.data);
      const { username, credential, iceServers } = response.data; // Assuming Cloudflare returns these fields
      res.setHeader("Content-Type", "application/json");
      res.status(200).send(JSON.stringify(iceServers));
    } else {
      console.error(
        "Failed to generate TURN credentials",
        response.status,
        response.data,
      );
      res.status(500).send({ error: "Failed to generate TURN credentials" });
    }
  } catch (error) {
    console.error("Error generating TURN credentials", error);
    res.status(500).send({ error: "Error generating TURN credentials" });
  }
});

app.get("/sessions", (req, res) => {
  res.json({ sessions });
});

// Helper function to send SSE messages
function sendEvent(clientId, event, data) {
  if (clients[clientId]) {
    // clients[clientId].response.write(`event: ${event}\n`);
    clients[clientId].response.write(
      `data: ${JSON.stringify({ ...data, ...{ type: event } })}\n\n`,
    );
  } else {
    console.log(`Client ${clientId} not found.`);
  }
}

// SSE endpoint
app.get("/events/:sessionId/:peerId", async (req, res) => {
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

  // await sendEvent(clientId, "connected", { time: new Date() });

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

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
  // const { clientType = "browser" } = req.body; // Expecting 'android' or 'browser'
  const clientType = "browser";
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
          senderId: peerId,
          // sessionId: sessionId,
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
        payload: payload,
        senderId: peerId,
      });
    } else {
      // Send SSE to browser client
      sendEvent(targetClientId, type, {
        payload,
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

const port = process.env.PORT || 3478;
server.listen(port, () => {
  console.log(`Signaling server running on port ${port}`);
});
