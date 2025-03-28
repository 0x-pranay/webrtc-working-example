//
const signalingServerUrl = "http://localhost:3478"; // Replace with your signaling server URL
// const signalingServerUrl = "https://api-dt1-dev-aps1.lightmetrics.co:3478"; // Replace with your signaling server URL
const peerId = generatePeerId(); // Generate a unique Peer ID
let sessionId = ""; // Session ID will be dynamically set

let eventSource;
let localStream;
const remoteStreams = {}; // Store remote streams by peer ID
const remoteAudioStream = {};
const remoteVideoStream = {};
let peerConnections = {}; // Store peer connections by peer ID
let offers = {};
let receivedOffers = {};
sentAnswers = {};
let answers = {};
let isDevice = false;

const lastBytesReceived = {};
const lastTimestamp = {};
let lastSentTimestamp;
let lastBytesSent;
let isStreaming = false;
let audioEnabled = true;
let videoEnabled = true;
let bandwidthCap = 0; // No cap by default
let iceServers;

// Get DOM elements
// const startStopButton = document.getElementById("startStopButton");
const sessionIdInput = document.getElementById("sessionIdInput");
const joinSessionButton = document.getElementById("joinSessionButton");
const copySessionIdButton = document.getElementById("copySessionIdButton");
const toggleAudioButton = document.getElementById("toggleAudioButton");
const toggleVideoButton = document.getElementById("toggleVideoButton");
const bandwidthSelect = document.getElementById("bandwidthSelect");
const localResolutionDisplay = document.getElementById("localResolution");
const localBitrateDisplay = document.getElementById("localBitrate");

// Codec
const codecPreferences = document.getElementById("codecPreferences");
const actualCodec = document.getElementById("actualCodec");
const supportsSetCodecPreferences =
  window.RTCRtpTransceiver &&
  "setCodecPreferences" in window.RTCRtpTransceiver.prototype;

async function getIceServers() {
  try {
    const response = await fetch(`${signalingServerUrl}/iceServers`);
    const data = await response.json();
    iceServers = data;
    console.log("ICE Servers:", iceServers);
  } catch (error) {
    console.error("Error getting ICE servers:", error);
    iceServers = null; // Handle the error appropriately
  }
  return iceServers;
}

async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: isDevice ? true : false,
      audio: true,
    });
    document.getElementById("localVideo").srcObject = localStream;
    isStreaming = true;
    // startStopButton.textContent = "Stop Stream";
    joinSessionButton.textContent = "Stop Stream";
    // joinSessionButton.disabled = true;
    toggleAudioButton.disabled = false;
    toggleVideoButton.disabled = false;
    // startLocalStats();
  } catch (error) {
    console.error("Error accessing media devices:", error);
  }
}

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    document.getElementById("localVideo").srcObject = null;
    localStream = null;
    isStreaming = false;
    // startStopButton.textContent = "Start Stream";
    joinSessionButton.textContent = "Start Stream";
    toggleAudioButton.disabled = true;
    toggleVideoButton.disabled = true;
    localResolutionDisplay.textContent = "";
    localBitrateDisplay.textContent = "";
  }

  if (localpc) {
    localpc.close();
  }
}

function createPeerConnection(remotePeerId) {
  console.log("creating peer connection with ", remotePeerId);
  // console.log("RTCPeerConfiguration", { iceServers });
  peerConnections[remotePeerId] = new RTCPeerConnection({
    iceServers: [iceServers],
  });

  peerConnections[remotePeerId].onicecandidate = async (event) => {
    console.log(
      "pc.onicecandidate. remotePeerId: ",
      remotePeerId,
      "event:",
      event,
    );
    if (event.candidate && remotePeerId !== "dummy") {
      sendIceCandidate(remotePeerId, event.candidate);
    }
  };

  peerConnections[remotePeerId].ontrack = async (event) => {
    console.log("pc.ontrack event", event, "streams: ", event.streams.length);

    if (event.track && event.streams.length === 0) {
      event.streams[0] = new MediaStream([event.track]);
    }

    if (event.streams && event.streams[0]) {
      console.log(
        "pc.ontrack.  audioTracks",
        await event.streams[0].getAudioTracks(),
        "videoTracks",
        await event.streams[0].getVideoTracks(),
        // await event.streams[0].getTracks(),
      );
      const audioTracks = await event.streams[0].getAudioTracks();
      const videoTracks = await event.streams[0].getVideoTracks();
      if (audioTracks.length > 0) {
        addRemoteAudioStream(remotePeerId, audioTracks);
      }
      if (videoTracks.length > 0) {
        addRemoteVideoStream(remotePeerId, videoTracks);
      }
    } else if (event.track) {
      if (event.track.kind === "audio") {
        addRemoteAudioStream(remotePeerId, [event.track]);
      }
      if (event.track.kind === "video") {
        addRemoteVideoStream(remotePeerId, [event.track]);
      }
    } else {
      console.log("no stream");
    }
  };

  peerConnections[remotePeerId].onconnectionstatechange = (event) => {
    console.log(
      "pc.onconnectionstatechange: ",
      peerConnections[remotePeerId].connectionState,
    );
    switch (peerConnections[remotePeerId].connectionState) {
      case "new":
        console.log(
          "pc.onconnectionstatechange. New connection with peer:",
          remotePeerId,
        );
        break;
      case "connected":
        console.log(
          "pc.onconnectionstatechange. Connected to peer:",
          remotePeerId,
        );
        break;
      case "disconnected":
      case "failed":
        console.log(
          "pc.onconnectionstatechange. Disconnected from peer:",
          remotePeerId,
        );
        break;
      case "closed":
        console.log("Connection closed with peer:", remotePeerId);
        break;
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(
      (track) => peerConnections[remotePeerId].addTrack(track, localStream), // Add each track to the connection
    );
  }

  // set H264 as preferred codec
  const [transceiver1] = peerConnections[remotePeerId].getTransceivers();

  console.log("transceiver1: ", transceiver1);

  if (transceiver1) {
    const codecs = RTCRtpSender.getCapabilities("video").codecs;
    const preferredOrder = ["video/H264"];

    // transceiver1.setCodecPreferences(sortByMimeTypes(codecs, preferredOrder));
    // console.log("prefers: ", transceiver1.getParameters());
  }
}

async function startStream(sessionId) {
  await getIceServers();
  await startLocalStream();
  const registrationSuccess = await registerWithServer(); // Register first
  if (registrationSuccess) {
    connectToSignalingServer();
  } else {
    console.error("Failed to register, cannot start stream.");
  }
}

toggleAudioButton.onclick = () => {
  audioEnabled = !audioEnabled;
  if (localStream) {
    localStream
      .getAudioTracks()
      .forEach((track) => (track.enabled = audioEnabled));
    toggleAudioButton.textContent = audioEnabled
      ? "Disable Audio"
      : "Enable Audio";
  }
};

toggleVideoButton.onclick = () => {
  videoEnabled = !videoEnabled;
  if (localStream) {
    localStream
      .getVideoTracks()
      .forEach((track) => (track.enabled = videoEnabled));
    toggleVideoButton.textContent = videoEnabled
      ? "Disable Video"
      : "Enable Video";
  }
};

bandwidthSelect.onchange = async () => {
  bandwidthCap = parseInt(bandwidthSelect.value);
  console.log("Bandwidth cap selected: ", bandwidthCap);
  // Implement bandwidth capping using RTCRtpSender.setParameters()
  for (const remotePeerId in peerConnections) {
    const pc = peerConnections[remotePeerId];
    pc.getSenders().forEach(async (sender) => {
      if (sender.track && sender.track.kind === "video") {
        const parameters = sender.getParameters();
        parameters.encodings = [{ maxBitrate: bandwidthCap * 1000 }]; // Convert kbps to bps
        try {
          await sender.setParameters(parameters);
          console.log(`Bandwidth set to ${bandwidthCap} for ${remotePeerId}`);
        } catch (e) {
          console.error("Error setting bandwidth:", e);
        }
      }
    });
  }
};

function updateLocalStats() {
  if (localStream && localStream.getVideoTracks().length > 0) {
    const videoTrack = localStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    localResolutionDisplay.textContent = `${settings.width}x${settings.height}`;

    //This is a basic implementation.  A full implementation would require RTCRtpSender.getStats()
    localBitrateDisplay.textContent = "N/A";
  }
  // setTimeout(updateStats, 1000); // Refresh every 1 second
}

joinSessionButton.onclick = async () => {
  if (!isStreaming) {
    sessionId = sessionIdInput.value.trim();
    if (!sessionId) {
      sessionId = generateSessionId();
    }
    sessionIdInput.value = sessionId;
    // await startStream(sessionId);
    await requestLiveStream(sessionId);
  } else {
    alert("Please stop the current stream before joining a new session");
  }
};

copySessionIdButton.onclick = () => {
  navigator.clipboard
    .writeText(sessionId)
    .then(() => {
      console.log("Session ID copied to clipboard");
    })
    .catch((err) => {
      console.error("Failed to copy session ID: ", err);
    });
};

// --- Helper Functions ---
// Add remote video element to the page
function addRemoteVideoStream(peerId, tracks) {
  console.log("Adding remote video stream with id ", peerId);
  const remoteVideosDiv = document.getElementById("remoteVideos");
  let videoElement = document.getElementById(`remoteVideo_${peerId}`);
  // let audioElement = document.getElementById(`remoteAudio_${peerId}`);

  if (!videoElement) {
    videoElement = document.createElement("video");
    videoElement.id = `remoteVideo_${peerId}`;
    videoElement.autoplay = true;
    videoElement.classList.add("remoteVideo");

    // Create stats elements for remote video
    const statsDiv = document.createElement("div");
    statsDiv.id = `remoteStats_${peerId}`;
    statsDiv.innerHTML = `<p>Resolution: <span id="remoteResolution_${peerId}"></span></p><p>Bitrate: <span id="remoteBitrate_${peerId}"></span> </p>`;

    remoteVideosDiv.appendChild(videoElement);
    remoteVideosDiv.appendChild(statsDiv);
    startRemoteStats(peerId); // Start updating remote stats
  }

  const stream = new MediaStream([tracks[0]]);

  videoElement.srcObject = stream;
  // audioElement.srcObject = stream;
  // remoteStreams[peerId] = stream;
  remoteVideoStream[peerId] = stream;
}

function addRemoteAudioStream(peerId, tracks) {
  console.log("Adding audio remote stream with id ", peerId);
  const remoteVideosDiv = document.getElementById("remoteVideos");
  let audioElement = document.getElementById(`remoteAudio_${peerId}`);

  if (!audioElement) {
    audioElement = document.createElement("audio");
    // audioElement.id = `remoteAudio_${peerId}`;
    audioElement.dataset.trackId = peerId;
    audioElement.autoplay = true;
    audioElement.controls = true;
    audioElement.classList.add("remoteAudio");
    remoteVideosDiv.appendChild(audioElement);
    remoteVideosDiv.appendChild(document.createElement("br"));
  }
  const stream = new MediaStream(tracks);

  audioElement.srcObject = stream;
  remoteAudioStream[peerId] = tracks[0];
}

function startRemoteStats(peerId) {
  setInterval(() => {
    updateRemoteStats(peerId);
  }, 1000);
}

function startLocalStats() {
  setInterval(() => {
    updateLocalStats();
  }, 1000);
}

async function updateRemoteStats(peerId) {
  if (peerConnections[peerId]) {
    try {
      const stats = await peerConnections[peerId].getStats(null);
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") {
          const remoteResolutionDisplay = document.getElementById(
            `remoteResolution_${peerId}`,
          );
          const remoteBitrateDisplay = document.getElementById(
            `remoteBitrate_${peerId}`,
          );

          if (remoteResolutionDisplay && remoteBitrateDisplay) {
            //Resolution
            remoteResolutionDisplay.textContent = `${report.frameWidth}x${report.frameHeight}`;

            //Bitrate calculation
            const bytes = report.bytesReceived;
            const timestamp = report.timestamp;
            if (lastBytesReceived[peerId] && lastTimestamp[peerId]) {
              const bitrate = Math.round(
                (8 * (bytes - lastBytesReceived[peerId])) /
                  (timestamp - lastTimestamp[peerId]),
              );
              remoteBitrateDisplay.textContent = `${bitrate} kbps`;
            }

            lastBytesReceived[peerId] = bytes;
            lastTimestamp[peerId] = timestamp;
          }
        }

        if (report.type === "outbound-rtp" && report.kind === "video") {
          localResolutionDisplay.textContent = `${report.frameWidth}x${report.frameHeight}`;

          //Bitrate calculation
          const bytes = report.bytesSent;
          const timestamp = report.timestamp;
          if (lastBytesSent && lastSentTimestamp) {
            const bitrate = Math.round(
              (8 * (bytes - lastBytesSent)) / (timestamp - lastSentTimestamp),
            );
            localBitrateDisplay.textContent = `${bitrate} kbps`;
          }
          lastBytesSent = bytes;
          lastSentTimestamp = timestamp;
        }
      });
    } catch (e) {
      console.error("Error getting remote stats", e);
    }
  }
}

// setCodecs();
// Helper function to generate a unique peer ID
function generatePeerId() {
  const peerId = "peer-" + Math.random().toString(36).substring(2, 15);
  console.log(peerId);
  return peerId;
}

// Function to generate a unique session ID
function generateSessionId() {
  const sessionId = "session-" + Math.random().toString(36).substring(2, 15);
  // const sessionId = "sss";
  return sessionId;
}

function setCodecs() {
  if (supportsSetCodecPreferences) {
    const { codecs } = RTCRtpReceiver.getCapabilities("video");
    codecs.forEach((codec) => {
      if (
        ["video/red", "video/ulpfec", "video/rtx", "video/flexfec-03"].includes(
          codec.mimeType,
        )
      ) {
        return;
      }
      const option = document.createElement("option");
      option.value = (codec.mimeType + " " + (codec.sdpFmtpLine || "")).trim();
      option.innerText = option.value;
      codecPreferences.appendChild(option);
    });
    codecPreferences.disabled = false;
  }
}

function preferH264(sdp) {
  const lines = sdp.split("\r\n");
  // Filter out non-H.264 codecs (assuming 100 is the payload type for H.264)
  const h264PayloadType = "100";
  const excludeAudioCodes = [
    "opus",
    "PCMU",
    "PCMA",
    "ISAC",
    "G722",
    "ILBC",
    "G729",
    "CN",
    "telephone-event",
  ];
  const codecLines = lines.filter(
    (line) =>
      line.startsWith("a=rtpmap:") &&
      !line.includes("H264") &&
      !excludeAudioCodes.some((code) => line.includes(code)),
  );

  // Remove other codec lines
  const filteredLines = lines.filter((line) => !codecLines.includes(line));

  // Add H.264 codec line if not already present
  if (!filteredLines.some((line) => line.includes("H264"))) {
    filteredLines.push(`a=rtpmap:${h264PayloadType} H264/90000`);
  }

  // Rebuild the SDP
  return filteredLines.join("\r\n");
}

function gotRemoteStream(e) {
  // Set codec preferences on the receiving side.
  if (e.track.kind === "video" && supportsSetCodecPreferences) {
    const preferredCodec =
      codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== "") {
      const [mimeType, sdpFmtpLine] = preferredCodec.value.split(" ");
      const { codecs } = RTCRtpReceiver.getCapabilities("video");
      const selectedCodecIndex = codecs.findIndex(
        (c) => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine,
      );
      const selectedCodec = codecs[selectedCodecIndex];
      codecs.splice(selectedCodecIndex, 1);
      codecs.unshift(selectedCodec);
      e.transceiver.setCodecPreferences(codecs);
      console.log("Receiver's preferred video codec", selectedCodec);
    }
  }
}

function sortByMimeTypes(codecs, preferredOrder) {
  return codecs.sort((a, b) => {
    const indexA = preferredOrder.indexOf(a.mimeType);
    const indexB = preferredOrder.indexOf(b.mimeType);
    const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
    const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
    return orderA - orderB;
  });
}

async function getOutboundCodecStat(pc) {
  const stats = await pc.getStats();
  for (const stat of [...stats.values()]) {
    if (stat.type == "outbound-rtp") {
      return stats.get(stat.codecId);
    }
  }
  await wait(50); // Kludge around https://crbug.com/40821064 in Chrome
  return getOutboundCodecStat(pc);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// V2 live stream
let socket = null;
let localpc;

async function requestLiveStream(requestStreamId) {
  const clientId = document.getElementById("clientId").value || "lmqatesting2";
  const fleetId =
    document.getElementById("fleetId").value || "lmfleetAndroidTesting";
  // const deviceId =
  //   document.getElementById("deviceId").value || "864281042305442";
  const userIdChecked = document.getElementById("requestType").checked;
  const deviceIdChecked = document.getElementById("requestType2").checked;

  let userIdOrDeviceId = document.getElementById("userIdOrDeviceId").value;

  let userId;
  let deviceId;

  // global
  isDevice = deviceIdChecked;

  console.log("userId", userId);
  if ((userIdOrDeviceId === "" || userIdOrDeviceId === null) && userIdChecked) {
    userId = peerId || generatePeerId();
    document.getElementById("userIdOrDeviceId").value = userId;
  }

  if (
    deviceIdChecked &&
    (userIdOrDeviceId === "" || userIdOrDeviceId === null)
  ) {
    deviceId = generatePeerId();
    document.getElementById("userIdOrDeviceId").value = deviceId;
  }

  // validate inputs clientId,fleetId, userId or deviceId and sessionId
  if (
    (!clientId || !fleetId) &&
    userIdChecked &&
    !userId &&
    deviceIdChecked &&
    !deviceId
  ) {
    alert("Please enter all required fields");
    return;
  }

  const token = await fetchToken({
    clientId,
    fleetId,
    userId: userIdChecked ? userId : null,
    deviceId: deviceIdChecked ? deviceId : null,
    requestStreamId,
  });

  // save the token in localStore and retrieve it when needed
  localStorage.setItem("token", token);

  await getIceServers();
  await startLocalStream();
  console.log("got token", token);

  console.log("requestLiveStream clicked", {
    clientId,
    fleetId,
    deviceId,
    requestStreamId,
  });
  if (!socket) {
    socket = io(signalingServerUrl, {
      path: "/webrtc/",
      auth: {
        token,
      },
    });
  }

  socket.on("ping", (data) => {
    console.log("received ping", data);
  });

  socket.on("message", handleSocketMessages.bind({ socket }));
}

async function handleSocketMessages(arg, callback) {
  console.log("message received", arg);
  console.log("socketId:", this.socket.id);

  if (callback) {
    callback({ message: "received" });
  }

  const { type, payload } = arg;
  switch (type) {
    case "offer":
      // TODO: start here
      console.log("received offer", payload);

      await startLocalStream();

      localpc = new RTCPeerConnection({ iceServers: [iceServers] });
      peerConnections["remote-ss"] = localpc;
      remotePeerId = "remote-ss";

      localpc.onicecandidate = async (event) => {
        if (event.candidate && event.candidate?.candidate) {
          console.log("sending ice-candidate", event.candidate);
          this.socket.emit("message", {
            type: "ice-candidate",
            payload: event.candidate,
          });
        }
      };

      localpc.ontrack = async (event) => {
        console.log(
          "pc.ontrack event",
          event,
          "streams: ",
          event.streams.length,
          "track",
          event.track,
        );

        if (event.streams && event.streams[0]) {
          console.log(
            "pc.ontrack.  audioTracks",
            event.streams[0].getAudioTracks(),
            "videoTracks",
            event.streams[0].getVideoTracks(),
            // await event.streams[0].getTracks(),
          );
          const audioTracks = event.streams[0].getAudioTracks();
          const videoTracks = event.streams[0].getVideoTracks();
          if (audioTracks.length > 0) {
            addRemoteAudioStream(remotePeerId, audioTracks);
          }
          if (videoTracks.length > 0) {
            addRemoteVideoStream(remotePeerId, videoTracks);
          }
        } else if (event.track) {
          if (event.track.kind === "audio") {
            addRemoteAudioStream(event.track.id, [event.track]);
          }
          if (event.track.kind === "video") {
            addRemoteVideoStream(event.track.id, [event.track]);
          }
        } else {
          console.log("no stream");
        }
      };

      localpc.onconnectionstatechange = (event) => {
        console.log(
          "pc.onconnectionstatechange: ",
          peerConnections[remotePeerId].connectionState,
        );
        switch (peerConnections[remotePeerId].connectionState) {
          case "new":
            console.log(
              "pc.onconnectionstatechange. New connection with peer:",
              remotePeerId,
            );
            break;
          case "connected":
            console.log(
              "pc.onconnectionstatechange. Connected to peer:",
              remotePeerId,
            );
            break;
          case "disconnected":
          case "failed":
            console.log(
              "pc.onconnectionstatechange. Disconnected from peer:",
              remotePeerId,
            );
            break;
          case "closed":
            console.log("Connection closed with peer:", remotePeerId);
            break;
        }
      };

      if (localStream) {
        localStream.getTracks().forEach((track) => {
          console.log("adding track", track);
          // localpc.addTransceiver(track, { direction: "sendonly" });
          localpc.addTrack(track, localStream); // Add each track to the connection
        });
      }

      // if (isDevice) {
      //   localpc.addTransceiver("video", { direction: "sendonly" });
      //   localpc.addTransceiver("audio", { direction: "sendonly" });
      // } else {
      //   localpc.addTransceiver("audio", { direction: "sendonly" });
      //   // const audioTransceiver = localpc.addTransceiver("audio", {
      //   //   direction: "sendonly",
      //   // });
      //   //
      //   // const audioTrack = localStream.getAudioTracks()[0];
      //   //
      //   // console.log("audiotrack", audioTrack, audioTransceiver);
      //   // audioTransceiver.sender.replaceTrack(audioTrack);
      // }

      // if (localStream) {

      // localStream.getAudioTracks().forEach((track) => {
      //   const audioSender = localpc
      //     .getTransceivers()
      //     .find((t) => t.sender.track?.kind === "audio");
      //   // audioSender.sender.replaceTrack(track);
      //   console.log("audiotrack", track, audioSender);
      // });
      // localStream.getTracks().forEach((track) => {
      //   console.log("track added", track);
      //   localpc.addTrack(track, localStream); // Add each track to the connection
      // });
      // localStream.getTracks().forEach((track) => {
      //   console.log("track added", track);
      //   if (track.kind === "audio") {
      //     const t = localpc
      //       .getTransceivers()
      //       .find((t) => t.receiver.track.kind === "audio");
      //
      //     t.sender.replaceTrack(track);
      //     // .replaceTrack(track);
      //     // localpc.addTrack(track); // Add each track to the connection
      //   } else {
      //     localpc.addTrack(track, localStream); // Add each track to the connection
      //   }
      // });
      // }

      // send answer
      const offer = new RTCSessionDescription(payload);
      await localpc.setRemoteDescription(offer);

      // adding tracks

      // const audioSender = localpc
      //   .getTransceivers()
      //   .find((t) => t.sender.track?.kind === "audio");
      // audioSender.sender.replaceTrack(localStream.getAudioTracks()[0]);

      const answer = await localpc.createAnswer();
      await localpc.setLocalDescription(answer);
      this.socket.emit("message", { type: "answer", payload: answer });

      break;
    case "answer":
      // this.socket.emit("answer", payload);
      console.log("received answer", payload);
      break;
    case "ice-candidate":
      // this.socket.emit("ice-candidate", payload);
      if (localpc) {
        await localpc.addIceCandidate(new RTCIceCandidate(payload));
      }
      console.log("received ice-candidate", payload);
      break;
    case "leave":
      // this.socket.emit("leave", payload);
      console.log("received leave", payload);
      break;
    default:
      console.log("Unknown message type", type);
  }
}

async function fetchToken({
  clientId,
  fleetId,
  userId,
  deviceId,
  requestStreamId,
}) {
  const response = await fetch(signalingServerUrl + "/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId,
      fleetId,
      userId,
      deviceId,
      requestStreamId: requestStreamId || "streamId#1",
    }),
  });
  const { token } = await response.json();
  console.log("token", token);
  return token;
}

function stopLiveStream() {
  if (socket) {
    socket.disconnect();
    socket = null;
    document.getElementById("requestLiveStream").disabled = false;
    document.getElementById("stopLiveStream").disabled = true;
    document.getElementById("sessionId").innerText = "";
  }
}
