const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
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
    socket.peerId = `${socket.user.clientId}-${socket.user.fleetId}-${
      socket.user.deviceId ? socket.user.deviceId : socket.user.userId
    }`;
    next();
  });
});

io.on("connection", (socket) => {
  console.log("new connection", {
    transport: socket.conn.transport.name,
    socketId: socket.id,
    requestStreamId: socket.user.requestStreamId,
    user: socket.user,
    peerId: socket.peerId,
  });

  setInterval(() => {
    socket.emit("ping", { timestamp: new Date() });
  }, 30000);

  socket.on("disconnect", () => {
    console.log("disconnect. ", { socketId: socket.id });
    const { requestStreamId, clientId, fleetId, userId, deviceId } =
      socket.user;
    const peerId = socket.peerId;
    const session = sessionManager.getOrCreateSession(requestStreamId);
    //TODO: if webrtc connection is open but socketio is disconnected then wait for 1 min to reconnect without removing the peer, upon reconnection update the socket for the peer with the new socket object.
    // even after 1 min if the socket is not reconnected then remove the peer
    // If the webrtc connection is not open then remove the peer immediately
    //
    session.removePeer(peerId);
    if (session.peers.size === 0) {
      sessionManager.removeSession(requestStreamId);
    }
  });

  socket.on("message", handleSocketMessages.bind({ socket }));

  const { requestStreamId, clientId, fleetId, userId, deviceId } = socket.user;

  // TODO: Create a session or join this peer to the werbtc session
  const session = sessionManager.getOrCreateSession(requestStreamId);
  session.addPeerFromSocket(socket);
});

async function handleSocketMessages(arg, callback) {
  // console.log("message received", arg);
  console.log("message received", {
    peerId: this.socket.peerId,
    user: this.socket.user,
    messageType: arg.type,
  });
  // if (peer) {
  //   console.error("peer not found. failed", peerId, peer, arg);
  //   if (callback) {
  //     callback({ message: "received" });
  //   }
  //   return;
  // }

  const { requestStreamId } = this.socket.user;
  const { peerId } = this.socket;
  let peer;
  let session;
  const { type, payload } = arg;
  switch (type) {
    case "offer":
      console.log("received offer", payload);
      session = sessionManager.getOrCreateSession(requestStreamId);
      console.log("peers:", session.getPeers());
      peer = session.peers.get(peerId);
      const offer = await peer.receiveOfferAndSendAnswer(payload);
      this.socket.emit({ type: "answer", payload: offer });
      break;
    case "answer":
      // this.socket.emit("answer", payload);
      console.log("received answer", payload);
      session = sessionManager.getOrCreateSession(requestStreamId);
      console.log("peers:", session.getPeers());
      peer = session.peers.get(peerId);
      if (peer) {
        await peer.handleAnswer(payload);
      }
      console.log("peer not found", peerId, peer);
      break;
    case "ice-candidate":
      session = sessionManager.getOrCreateSession(requestStreamId);
      peer = session.peers.get(peerId);
      console.log("handling ice-candidates", {
        // peerId,
        // requestStreamId,
        session,
        peer,
      });
      // this.socket.emit("ice-candidate", payload);
      console.log("received ice-candidate", payload);
      if (payload.candidate && peer) {
        await peer.addIceCandidate(payload);
      }
      if (!peer) {
        console.error("peer not found", peerId, peer);
      }

      break;
    case "leave":
      // this.socket.emit("leave", payload);
      console.log("received leave", payload);
      break;
    default:
      console.log("Unknown message type", type);
  }
  // handleLeave

  if (callback) {
    callback({ message: "received" });
  }
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

app.get("/sessions", async (req, res) => {
  // res.json({ sessions, sessionv2: sessionManager.listSessions() });
  const sockets = await io.fetchSockets();
  res.json({
    ...sessionManager.listSessions(),
    sockets: sockets.map((socket) => ({
      id: socket.id,
      requestStreamId: socket.user.requestStreamId,
      user: socket.user,
    })),
  });
  // res.json({
  //   sessions: sessionManager.listSessions(),
  //   // sockets: await io.fetchSockets(),
  //   connectedClients: io.engine.connectedClients,
  //   connectedClients2: io.sockets.size,
  // });
});

const port = process.env.PORT || 3478;
server.listen(port, () => {
  console.log(`Signaling server running on port ${port}`);
});
