class SignalingStrategy {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
  }
  handleMessage() {}
  sendMessage() {}
}

class SocketIoSignaling extends SignalingStrategy {
  constructor(io, sessionManager) {
    super(sessionManager);
    this.io = io;
    this.setupSocketEvents();
  }

  setupSocketEvents() {
    this.io.on("connection", (socket) => {
      console.log("New client connected", socket.id);

      socket.on("requestLiveStream", ({ sessionId }) => {
        const session = this.sessionManager.getOrCreateSession(sessionId);
        this.io.to(sessionId).emit("startLiveStream");
      });

      socket.on("joinSession", async ({ sessionId, peerType }) => {
        socket.join(sessionId);
        const session = this.sessionManager.getOrCreateSession(sessionId);
        const peer = session.addPeer(socket.id, peerType);
        socket.emit("offer", await peer.createOffer());
      });

      socket.on("answer", ({ sessionId, answer }) => {
        this.sessionManager.sessions
          .get(sessionId)
          ?.peers.get(socket.id)
          ?.setRemoteAnswer(answer);
      });

      socket.on("iceCandidate", ({ sessionId, candidate }) => {
        this.sessionManager.sessions
          .get(sessionId)
          ?.peers.get(socket.id)
          ?.addIceCandidate(candidate);
      });

      socket.on("disconnect", () => {
        for (const [
          sessionId,
          session,
        ] of this.sessionManager.sessions.entries()) {
          if (session.peers.has(socket.id)) {
            session.removePeer(socket.id);
            if (!session.peers.size)
              this.sessionManager.removeSession(sessionId);
            break;
          }
        }
      });
    });
  }
  handleMessage() {}
  sendMessage() {}
}

class HttpSignaling extends SignalingStrategy {
  constructor(app, sessionManager) {
    super(sessionManager);
    this.app = app;
    this.setupHttpRoutes();
  }

  setupHttpRoutes() {
    this.app.get("/events/:sessionId/:peerId", (req, res) => {
      const { sessionId, peerId } = req.params;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const session = this.sessionManager.getOrCreateSession(sessionId);
      session.addEventListener(peerId, (data) =>
        res.write(`data: ${JSON.stringify(data)}\n\n`),
      );
    });

    this.app.post("/message/:sessionId/:peerId", (req, res) => {
      const { sessionId, peerId } = req.params;
      const { type, data } = req.body;
      const session = this.sessionManager.getOrCreateSession(sessionId);
      session.handleMessage(peerId, type, data);
      res.sendStatus(200);
    });
  }
}
