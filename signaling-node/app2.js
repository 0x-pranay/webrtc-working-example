const express = require("express");
const http = require("http");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const https = require("https");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const { getIceServers } = require("./lib/turn.js");
const { sessionManager } = require("./lib/connectionManager.js");

/* Socket */

const socketio = require("socket.io");

/* Initialize Express */
const SIGNALING_SERVER_JWT_SECRET_KEY =
  process.env.SIGNALING_SERVER_JWT_SECRET_KEY;

if (!SIGNALING_SERVER_JWT_SECRET_KEY) {
  console.error("SIGNALING_SERVER_JWT_SECRET_KEY is required");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json()); // for parsing application/json

app.use(express.static(path.join(__dirname, "www")));

const server = http.createServer(app);

const sessions = new Map();

/* Socket IO */

const io = new socketio.Server(server, {
  path: "/webrtc/",
  cors: { origin: "*" },
  methods: ["GET", "POST"],
});

io.use((socket, next) => {
  const token =
    socket.handshake.headers.token ||
    socket.handshake.query.token ||
    socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }
  jwt.verify(token, SIGNALING_SERVER_JWT_SECRET_KEY, (err, decoded) => {
    if (err) {
      return next(new Error("Authentication error: Invalid token"));
    }
    socket.user = decoded; // Attach token payload (e.g., user/device id) to socket
    socket.peerId = `${socket.user.clientId}-${socket.user.fleetId}-${socket.user.deviceId ? socket.user.deviceId : socket.user.userId}`;
    next();
  });
});

io.on("connection", (socket) => {
  console.log("connection", {
    transport: socket.conn.transport.name,
    socketId: socket.id,
    user: socket.user,
  });

  setInterval(() => {
    socket.emit("ping", { timestamp: new Date() });
  }, 30000);

  socket.on("disconnect", () => {
    console.log("disconnect. ", { socketId: socket.id });
  });

  socket.on("message", handleSocketMessages.bind({ socket }));

  const { requestStreamId, clientId, fleetId, userId, deviceId } = socket.user;

  // TODO: Create a session or join this peer to the werbtc session
  const session = sessionManager.getOrCreateSession(requestStreamId);
  session.addPeerFromSocket(socket);
});

async function handleSocketMessages(arg, callback) {
  console.log("message received", arg);
  console.log("this", this.socket.id);

  if (callback) {
    callback({ message: "received" });
  }

  const peerId = this.socket.peerId;
  const { requestStreamId } = this.socket.user;
  const session = sessionManager.getOrCreateSession(requestStreamId);
  const peer = session.peers.get(peerId);

  // sendOffer: done
  // handleAnswer
  const { type, payload } = arg;
  switch (type) {
    case "offer":
      // this.socket.emit("offer", payload);
      console.log("received offer", payload);
      const offer = await peer.receiveOfferAndSendAnswer(payload);
      socket.emit({ type: "answer", payload: offer });
      break;
    case "answer":
      // this.socket.emit("answer", payload);
      console.log("received answer", payload);
      await peer.handleAnswer(payload);
      break;
    case "ice-candidate":
      // this.socket.emit("ice-candidate", payload);
      console.log("received ice-candidate", payload);
      await peer.addIceCandidate(payload);
      break;
    case "leave":
      this.socket.emit("leave", payload);
      break;
    default:
      console.log("Unknown message type", type);
  }
  // sendIceCandidates
  // handleIceCandidates
  // handleLeave
}

function getSocketByStreamId(streamId) {
  return io.sockets.sockets.find(
    (socket) => socket.user.requestStreamId === streamId,
  );
}

/* Routers */

app.get("/iceServers", async (req, res) => {
  console.log("requested IceServers");
  const iceServers = await getIceServers();
  res.json(iceServers);
});

app.post("/token", (req, res) => {
  const { requestStreamId, clientId, fleetId, userId, deviceId } = req.body;
  const token = jwt.sign(
    { requestStreamId, clientId, fleetId, userId, deviceId },
    SIGNALING_SERVER_JWT_SECRET_KEY,
    {
      expiresIn: "24h",
    },
  );
  res.json({ token });
});

app.get("/sessions", (req, res) => {
  // res.json({ sessions, sessionv2: sessionManager.listSessions() });
  res.json({
    todo: "todo",
    sessions: sessionManager.listSessions(),
    sockets: io.fetchSockets(),
  });
});

const port = process.env.PORT || 3478;
server.listen(port, () => {
  console.log(`Signaling server running on port ${port}`);
});
