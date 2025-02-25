// Configuration
// const signalingServerUrl = "http://localhost:8080"; // Replace with your signaling server URL
const signalingServerUrl = "https://api-dt1-dev-aps1.lightmetrics.co:3478"; // Replace with your signaling server URL
const peerId = generatePeerId(); // Generate a unique Peer ID
let sessionId = ""; // Session ID will be dynamically set

let eventSource;
let localStream;
const remoteStreams = {}; // Store remote streams by peer ID
let peerConnections = {}; // Store peer connections by peer ID

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
const startStopButton = document.getElementById("startStopButton");
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

function connectToSignalingServer() {
  eventSource = new EventSource(
    `${signalingServerUrl}/events/${sessionId}/${peerId}`,
  );

  eventSource.onopen = () => {
    console.log("Connection to the signaling server (SSE) is open");
    // registerWithServer();
  };

  eventSource.onmessage = (event) => {
    handleSignalingMessage(event);
  };

  eventSource.onerror = (error) => {
    console.error("SSE error:", error);
  };

  eventSource.onclose = () => {
    console.log("Connection to the the signaling server (SSE) is closed");
  };
}

async function registerWithServer() {
  return fetch(`${signalingServerUrl}/register/${sessionId}/${peerId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ clientType: "browser" }),
  })
    .then((response) => response.json())
    .then((data) => {
      // console.log("Registration response:", data);
      if (data.message === "Registered") {
        console.log("Successfully registered with the signaling server.");
        return true; // Indicate successful registration
      } else {
        console.error("Registration failed.");
        return false; // Indicate registration failure
      }
    })
    .catch((error) => {
      console.error("Error during registration:", error);
      return false; // Indicate registration failure
    });
}

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
      video: false,
      audio: true,
    });
    document.getElementById("localVideo").srcObject = localStream;
    isStreaming = true;
    startStopButton.textContent = "Stop Stream";
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
    startStopButton.textContent = "Start Stream";
    toggleAudioButton.disabled = true;
    toggleVideoButton.disabled = true;
    localResolutionDisplay.textContent = "";
    localBitrateDisplay.textContent = "";
  }
}

async function handleSignalingMessage(event) {
  try {
    const message = JSON.parse(event.data);
    const { type, senderId, payload } = message;
    console.log("received sse-event:", message);

    switch (type) {
      case "new-peer":
        console.log("New peer joined:", senderId);
        createPeerConnection(senderId);
        // Send an offer to the newly joined peers
        sendOffer(senderId);
        break;
      case "offer":
        console.log("Received offer from:", senderId);
        handleOffer(senderId, payload);
        break;
      case "answer":
        console.log("Received answer from:", message.senderId);
        handleAnswer(senderId, payload);
        break;
      case "ice-candidate":
        console.log("Received ICE candidate from:", message.senderId);
        handleIceCandidate(senderId, payload);
        break;
      // case "ping":
      //   console.log("Received ping: ", message);
      //   break;
      default:
        console.log("Received unknown message:", message);
    }
  } catch (error) {
    console.error("Error parsing SSE message:", error);
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
    console.log(
      "pc.ontrack event",
      event,
      "streams: ",
      event.streams.length,
      "tracks:",
      // await event.streams[0].getTracks(),
    );

    // gotRemoteStream(event);

    if (event.streams && event.streams[0] && remotePeerId !== "dummy") {
      addRemoteVideoStream(remotePeerId, event.streams[0]);
    } else {
      console.log("no stream");
    }
  };

  // peerConnections[remotePeerId].onaddstream = async (event) => {
  //   console.log("pc.onaddstream event", event);
  //   const audioTracks = await event.stream.getAudioTracks();
  //   const videoTracks = await event.stream.getVideoTracks();
  //
  //   console.log(audioTracks, videoTracks);
  //   // if (event.stream && event.stream[0] && remotePeerId !== "dummy") {
  //   //   addRemoteVideoStream(remotePeerId, event.streams[0]);
  //   // } else {
  //   //   console.log("no stream");
  //   // }
  // };

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
    localStream.getAudioTracks().forEach(
      (track) => peerConnections[remotePeerId].addTrack(track, localStream), // Add each track to the connection
    );

    // transceiver = peerConnections[remotePeerId].addTransceiver("video", {
    //   direction: "recvonly",
    //   sendEncodings: [{ rid: "r0", maxBitrate: 100000 }],
    //   streams: [localStream],
    // });
    //
    // const preferredCodec =
    //   codecPreferences.options[codecPreferences.selectedIndex];
    // if (preferredCodec.value !== "") {
    //   const [mimeType, sdpFmtpLine] = preferredCodec.value.split(" ");
    //   const { codecs } = RTCRtpReceiver.getCapabilities("video");
    //   const selectedCodecIndex = codecs.findIndex(
    //     (c) => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine,
    //   );
    //   const selectedCodec = codecs[selectedCodecIndex];
    //   codecs.splice(selectedCodecIndex, 1);
    //   codecs.unshift(selectedCodec);
    //   transceiver.setCodecPreferences(codecs);
    //   console.log("Receiver's preferred video codec", selectedCodec);
    // }
    // transceiver.setCodecPreferences([
    //   { mimeTypes: ["video/H264"], clockRate: 90000, channels: 0 },
    // ]);
  }
}

async function sendOffer(remotePeerId) {
  console.log("creating offer with ", remotePeerId);
  const offer = await peerConnections[remotePeerId].createOffer();
  // const offer = await peerConnections[remotePeerId].createOffer({
  //   offerToReceiveAudio: true,
  //   offerToReceiveVideo: true,
  // });

  const modifiedOffer = new RTCSessionDescription({
    type: offer.type,
    // sdp: preferH264(offer.sdp),
    sdp: offer.sdp,
  });

  console.log("offer", offer, "modifiedOffer", modifiedOffer);
  await peerConnections[remotePeerId].setLocalDescription(modifiedOffer);
  sendSignalingMessage(remotePeerId, "offer", modifiedOffer);
}

async function handleOffer(remotePeerId, offer) {
  console.log("handling offer with ", remotePeerId);
  if (!peerConnections[remotePeerId]) {
    createPeerConnection(remotePeerId);
  }

  await peerConnections[remotePeerId].setRemoteDescription(
    new RTCSessionDescription(offer),
  );
  const answer = await peerConnections[remotePeerId].createAnswer();
  await peerConnections[remotePeerId].setLocalDescription(answer);
  sendSignalingMessage(remotePeerId, "answer", answer);
}

async function handleAnswer(remotePeerId, answer) {
  console.log("handling answer with ", remotePeerId);
  if (peerConnections[remotePeerId] && !peerConnections["dummy"]) {
    await peerConnections[remotePeerId].setRemoteDescription(
      new RTCSessionDescription(answer),
    );
  }
}

async function handleIceCandidate(remotePeerId, iceCandidate) {
  try {
    console.log("handling ice candidate with ", remotePeerId);
    if (peerConnections[remotePeerId]) {
      await peerConnections[remotePeerId].addIceCandidate(
        new RTCIceCandidate(iceCandidate),
      );
    }
  } catch (e) {
    console.error("Error adding received ICE candidate", e, iceCandidate);
  }
}

function sendIceCandidate(remotePeerId, iceCandidate) {
  console.log("sending iceCandidates", remotePeerId, iceCandidate);
  sendSignalingMessage(remotePeerId, "ice-candidate", iceCandidate);
}

function sendSignalingMessage(remotePeerId, type, data) {
  fetch(`${signalingServerUrl}/message/${sessionId}/${peerId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      target: remotePeerId,
      type: type,
      payload: data,
    }),
  });
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

startStopButton.onclick = async () => {
  if (isStreaming) {
    stopLocalStream();
    eventSource.close();
  } else {
    //New order
    sessionId = generateSessionId();
    sessionIdInput.value = sessionId; // Update the input field with the session ID
    await startStream(sessionId);
  }
};

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
  sessionId = sessionIdInput.value.trim();
  if (!sessionId) {
    sessionId = generateSessionId();
  }
  sessionIdInput.value = sessionId;
  await startStream(sessionId);
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
function addRemoteVideoStream(peerId, stream) {
  console.log("Adding remote stream with id ", peerId);
  const remoteVideosDiv = document.getElementById("remoteVideos");
  let videoElement = document.getElementById(`remoteVideo_${peerId}`);

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
  videoElement.srcObject = stream;
  remoteStreams[peerId] = stream;
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
