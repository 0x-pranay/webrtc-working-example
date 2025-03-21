const {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStreamTrack,
  nonstandard: { RTCAudioSink, RTCVideoSink, RTCVideoSource, RTCAudioSource },
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
    this.socketState = socket.readyState;
    this.joinDate = new Date().toISOString();
    this.leftDate = null;
    this.pc = null;
    this.tracks = {};
  }

  async create() {
    const iceServers = await getIceServers();
    this.pc = new RTCPeerConnection({
      iceServers: [iceServers],
    });
    this.pc.onicecandidate = this.onIceCandidate;
    this.pc.ontrack = this.onTrack;
    this.pc.onconnectionstatechange = () => {
      console.log(
        `Connection state for ${this.socket.id}: ${this.pc.connectionState}`,
      );
    };

    return this.pc;
  }

  onIceCandidate = (event) => {
    if (event.candidate) {
      console.log("sending ice candidate", event.candidate.candidate);
      // Send the candidate to the remote peer
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
        console.log("event.track", event.track);

        // Get tracks of other peers and replace the tracks with the current peers tracks
        this.pc.getSenders().forEach((sender) => {
          for (const [trackId, track] of Object.entries(peer.tracks)) {
            if (sender.track.kind === track.kind) {
              console.log("replacing track", trackId, "to", targertPeerId);
              sender.replaceTrack(track);
            }
          }
        });

        if (this.isDevice && !peer.isDevice) {
          peer.pc.getSenders().forEach((sender) => {
            if (
              sender.track.kind === event.track.kind &&
              sender.track.kind === "audio"
            ) {
              console.log("replacing audio track to device");
              sender.replaceTrack(event.track);
            }

            if (
              sender.track.kind === event.track.kind &&
              sender.track.kind === "video"
            ) {
              console.log("replacing audio track to clients");
              sender.replaceTrack(event.track);
            }
          });
        } else if (!this.isDevice && peer.isDevice) {
          peer.pc.getSenders().forEach((sender) => {
            if (
              sender.track.kind === event.track.kind &&
              sender.track.kind === "audio"
            ) {
              console.log("replacing audio track to clients");
              sender.replaceTrack(event.track);
            }
          });
        } else if (!this.isDevice && !peer.isDevice) {
          peer.pc.getSenders().forEach((sender) => {
            if (
              sender.track.kind === event.track.kind &&
              sender.track.kind === "audio"
            ) {
              console.log("replacing audio track to clients");
              sender.replaceTrack(event.track);
            }
            // TODO: remove this condition
            if (
              sender.track.kind === event.track.kind &&
              sender.track.kind === "video"
            ) {
              console.log("replacing audio track to clients");
              sender.replaceTrack(event.track);
            }
          });
        }

        this.tracks[event.track.id] = event.track;
      }
    });
  };

  async createOffer() {
    if (this.isDevice) {
      const audioSource = new RTCAudioSource();
      const audioTrack = audioSource.createTrack();
      this.pc.addTrack(audioTrack);
    } else {
      const audioSource = new RTCAudioSource();
      const videoSource = new RTCVideoSource();
      const audioTrack = audioSource.createTrack();
      const videoTrack = videoSource.createTrack();
      this.pc.addTrack(audioTrack);
      this.pc.addTrack(videoTrack);
    }

    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
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
    try {
      console.log("received answer", answer);
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error("error in handleAnswer", error);
    }
  };

  addIceCandidate(candidate) {
    this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  toJSON() {
    return {
      peerId: this.peerId,
      isDevice: this.isDevice,
      pcState: this.pc.connectionState,
      tracks: Object.keys(this.tracks).map((trackId) => {
        const track = this.tracks[trackId];
        return {
          id: track.id,
          kind: track.kind,
          label: track.label,
          enabled: track.enabled,
        };
      }),
      joinDate: this.joinDate,
      leftDate: this.leftDate,
      socketState: this.socketState,
      socketId: this.socket.id,
    };
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
    this.starttime = new Date().toISOString();
    this.endtime = null;
    this.lastUpdated = null;
    this.activityLog = [];
  }

  // async addPeer(peerId, peerType) {
  //   if (!this.peers.has(peerId)) {
  //     const peer = new PeerConnection(peerId, peerType, this);
  //     this.peers.set(peerId, peer);
  //     return peer;
  //   }
  // }

  async addPeerFromSocket(socket) {
    const { requestStreamId, clientId, fleetId, userId, deviceId } =
      socket.user;
    const peerId = socket.peerId;
    console.log("addPeerFromSocket", {
      requestStreamId,
      clientId,
      fleetId,
      userId,
      deviceId,
      peerExists: this.peers.has(peerId),
    });

    // TODO: check if the webrtc connection is already established and open
    if (!this.peers.has(peerId)) {
      const peerType = socket.user.deviceId ? "device" : "web-client";
      const peerId = socket.peerId;
      const peer = new PeerConnection(peerId, peerType, socket, this);
      this.peers.set(peerId, peer);

      await peer.create();
      // send offer to the connected peer
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
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

      this.activityLog.push({
        event: "peer-connected",
        timestamp: new Date().toISOString(),
        peer: {
          peerId,
          clientId,
          fleetId,
          userId,
          deviceId,
        },
      });
    } else {
      console.error("peer already exists", peerId);
    }
  }

  removePeer(peerId) {
    this.peers.delete(peerId);
  }

  handleSocketDisconnects(socket) {
    const { requestStreamId, clientId, fleetId, userId, deviceId } =
      socket.user;
    const peerId = socket.peerId;

    if (this.peers.has(peerId)) {
      this.peers.delete(peerId);
    }
    this.activityLog.push({
      event: "peer-disconnected",
      timestamp: new Date().toISOString(),
      peer: {
        peerId,
        clientId,
        fleetId,
        userId,
        deviceId,
      },
    });
  }

  getPeers() {
    return this.peers.keys();
  }

  getDevicePeers() {
    return Array.from(this.peers)
      .map(([peerId, peer]) => {
        if (peer.isDevice) {
          return peer;
        }
        return undefined;
      })
      .filter((peer) => peer);
  }

  getWebClientPeers() {
    return Array.from(this.peers).map(([peerId, peer]) => {
      if (!peer.isDevice) {
        return peer;
      }
    });
  }

  getPeer(peerId) {
    // return this.peers.get(peerId);
    return Array.from(this.peers);
  }

  close() {
    this.peers.forEach((peer) => peer.pc.close());
    this.peers.clear();
    this.endtime = new Date().toISOString();
    this.activityLog.push({
      event: "session-closed",
      timestamp: new Date().toISOString(),
    });
    // this.recorder.stopRecording();
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      peers: Array.from(this.peers).map(([peerId, peer]) => {
        return peer.toJSON();
      }),
      peerCount: this.peers.size,
      devicePeeers: this.getDevicePeers(),
      webClientPeers: this.getWebClientPeers(),
      starttime: this.starttime,
      endtime: this.endtime,
      activityLog: this.activityLog,
    };
  }
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.oldSessions = new Map();
    // store utc timestamp when the session manager is created
  }

  getOrCreateSession(sessionId) {
    return this.sessions.has(sessionId)
      ? this.sessions.get(sessionId)
      : this.createSession(sessionId);
  }

  createSession(sessionId) {
    console.log("creating a new session", sessionId);
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Session(sessionId));
    }
    return this.sessions.get(sessionId);
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  listSessions() {
    return {
      sessions: Array.from(this.sessions).map(
        ([sessionId, session]) => session,
      ),
      oldSessions: Array.from(this.oldSessions).map(
        ([sessionId, session]) => session,
      ),
    };
  }

  removeSession(sessionId) {
    console.log("removing a session", sessionId);
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      session.close();
      this.oldSessions.set(sessionId, session);
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
