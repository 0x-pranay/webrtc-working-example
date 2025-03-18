const {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
} = require("@roamhq/wrtc");
const fs = require("fs");
const { spawn } = require("child_process");

const { getIceServers } = require("./turn.js");

class PeerConnection {
  constructor(peerId, peerType, socket, session) {
    this.peerId = peerId;
    this.isDevice = peerType === "device";
    this.session = session;
    this.socket = socket;
    this.pc = null;
    this.tracks = null;
    // this.pc.console // Do log all the connections states for the peer
    //   .log(
    //     `Initiating connection for peer ${this.peerId} in session: ${this.session}`,
    //   );
  }

  async create() {
    const iceServers = await getIceServers();
    this.pc = new RTCPeerConnection({
      iceServers: [iceServers],
    });
    this.pc.onicecandidate = this.onIceCandidate;
    this.pc.ontrack = this.onTrack;
    this.pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${socket.id}: ${pc.connectionState}`);
    };

    return this.pc;
  }

  onIceCandidate = (event) => {
    if (event.candidate) {
      // Send the candidate to the remote peer
      console.log("TODO: Sending ICE candidate");
      this.socket.emit("message", {
        type: "ice-candidate",
        // requestStreamId: this.session.sessionId,
        payload: event.candidate,
      });
    } else {
      // All ICE candidates have been sent
      console.log("ICE candidate gathering complete");
    }
  };

  onTrack = (event) => {
    console.log("ontrack event called");
    // this.session.recorder.recordTrack(event.track, this.peerId);
    this.session.peers.forEach((peer, targertPeerId) => {
      if (targertPeerId !== this.peerId) {
        console.log(
          "forwarding track from peer",
          this.peerId,
          "to peer",
          targertPeerId,
        );
        peer.pc.addTrack(event.track);
      } else {
        this.tracks[event.track.id] = event.track;
      }
    });
  };

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    console.log("Sending SDP offer");
    return offer;
  }

  async setRemoteAnswer(answer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async receiveOfferAndSendAnswer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    console.log("Sending SDP answer");
    return answer;
  }

  handleAnswer = async (answer) => {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  };

  addIceCandidate() {
    this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

/*
 * Session class
 * Represents a session with multiple peers
 * Each session has a unique sessionId
 * */
class Session {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.peers = new Map();
  }

  async addPeer(peerId, peerType) {
    if (!this.peers.has(peerId)) {
      const peer = new PeerConnection(peerId, peerType, this);
      this.peers.set(peerId, peer);
      return peer;
    }
  }

  async addPeerFromSocket(socket) {
    const { requestStreamId, clientId, fleetId, userId, deviceId } =
      socket.user;
    const peerId = socket.peerId;

    // TODO: check if the webrtc connection is already established and open
    if (!this.peers.has(peerId)) {
      const peerType = socket.user.deviceId ? "device" : "web-client";
      const peerId = socket.peerId;
      const peer = new PeerConnection(peerId, peerType, socket, this);
      await peer.create();
      // send offer to the connected peer
      const offer = await peer.createOffer();
      socket.emit(
        "message",
        {
          type: "offer",
          // requestStreamId: this.sessionId,
          payload: offer,
        },
        (response) => {
          console.log("offer sent to peer", peerId, response.status);
        },
      );
    }
  }

  getPeers() {
    return this.peers.keys();
  }

  getDevicePeer() {
    return this.peers.keys().map((peerId) => {
      if (this.peers.get(peerId).isDevice) {
        return this.peers.get(peerId);
      }
    });
  }

  getWebClientPeer() {
    return this.peers.keys().map((peerId) => {
      if (!this.peers.get(peerId).isDevice) {
        return this.peers.get(peerId);
      }
    });
  }

  getPeer(peerId) {
    return this.peers.get(peerId);
  }

  close() {
    this.peers.forEach((peer) => peer.pc.close());
    this.peers.clear();
    // this.recorder.stopRecording();
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  getOrCreateSession(sessionId) {
    return this.sessions.has(sessionId)
      ? this.sessions.get(sessionId)
      : this.createSession(sessionId);
  }

  createSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Session(sessionId));
    }
    return this.sessions.get(sessionId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  listSessions() {
    return Array.from(this.sessions).map(([sessionId, session]) => {
      return { sessionId, peers: session.getPeers() };
    });
  }

  removeSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      this.sessions.get(sessionId).close();
      this.sessions.delete(sessionId);
    }
  }
}

class Recorder {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.outputFile = "recordings/session_${sessionId}.webm";
    this.ffmpegProcess = null;
    if (!fs.existsSync("recordings")) {
      fs.mkdirSync("recordings");
    }
  }

  recordTrack(track, peerId) {
    console.log(`Recording track from peer ${peerId}`);
    if (!this.ffmpegProcess) {
      this.ffmpegProcess = spawn("ffmpeg", [
        "-y",
        "-f",
        "webm",
        "-i",
        "pipe:0",
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        this.outputFile,
      ]);
    }

    const mediaStream = new MediaStream([track]);
    const mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: "video/webm",
    });
    mediaRecorder.ondataavailable = (event) =>
      event.data.size && this.ffmpegProcess?.stdin.write(event.data);
    mediaRecorder.start(1000);
  }

  stopRecording() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.stdin.end();
      this.ffmpegProcess = null;
      console.log(`Recording saved to ${this.outputFile}`);
    }
  }
}

let sessionManager;
if (!sessionManager) {
  sessionManager = new SessionManager();
}

module.exports.sessionManager = sessionManager;
// module.exports.PeerConnection = PeerConnection;
// module.exports.Session = Session;

// make sessionManager object a  singleton to be used across the application

// const sessionManager = new SessionManager();
// module.exports.sessionManager = sessionManager;

// exports.SessionManager = SessionManager;
