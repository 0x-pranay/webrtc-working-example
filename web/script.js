// Configuration
const signalingServerUrl = "http://localhost:8080"; // Replace with your signaling server URL
const peerId = generatePeerId(); // Generate a unique Peer ID
let sessionId = ""; // Session ID will be dynamically set

let eventSource;
let localStream;
const remoteStreams = {}; // Store remote streams by peer ID
let peerConnections = {}; // Store peer connections by peer ID

const lastBytesReceived = {};
const lastTimestamp = {};
let isStreaming = false;
let audioEnabled = true;
let videoEnabled = true;
let bandwidthCap = 0; // No cap by default
let iceServers;

// Get DOM elements
const sessionIdInput = document.getElementById("sessionIdInput");
const joinSessionButton = document.getElementById("joinSessionButton");
const copySessionIdButton = document.getElementById("copySessionIdButton");
const startStopButton = document.getElementById("startStopButton");
const toggleAudioButton = document.getElementById("toggleAudioButton");
const toggleVideoButton = document.getElementById("toggleVideoButton");
const bandwidthSelect = document.getElementById("bandwidthSelect");
const localResolutionDisplay = document.getElementById("localResolution");
const localBitrateDisplay = document.getElementById("localBitrate");

getIceServers();
// --- 1. Establish SSE connection ---
function connectToSignalingServer() {
  eventSource = new EventSource(
    `${signalingServerUrl}/events/${sessionId}/${peerId}`,
  );

  eventSource.onopen = () => {
    console.log("Connected to the signaling server (SSE)");
    // registerWithServer();
  };

  eventSource.onmessage = (event) => {
    handleSignalingMessage(event);
  };

  eventSource.onerror = (error) => {
    console.error("SSE error:", error);
  };

  eventSource.onclose = () => {
    console.log("Disconnected from the signaling server (SSE)");
  };
}

// --- 2. Register with the signaling server ---
function registerWithServer() {
  return fetch(`${signalingServerUrl}/register/${sessionId}/${peerId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ clientType: "browser" }),
  })
    .then((response) => response.json())
    .then((data) => {
      console.log("Registration response:", data);
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

// --- 3. Get ICE Servers ---
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

// --- 4. Get User Media (Local Stream) ---
async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    document.getElementById("localVideo").srcObject = localStream;
    isStreaming = true;
    startStopButton.textContent = "Stop Stream";
    toggleAudioButton.disabled = false;
    toggleVideoButton.disabled = false;
    updateStats();
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

// --- 5. Handle Signaling Messages ---
async function handleSignalingMessage(event) {
  try {
    const message = JSON.parse(event.data);
    console.log(message);

    switch (message.type) {
      case "new-peer":
        console.log("New peer joined:", message.senderId);
        createPeerConnection(message.senderId);
        sendOffer(message.senderId);
        break;
      case "offer":
        console.log("Received offer from:", message.senderId);
        handleOffer(message.senderId, message.data);
        break;
      case "answer":
        console.log("Received answer from:", message.senderId);
        handleAnswer(message.senderId, message.data);
        break;
      case "ice-candidate":
        console.log("Received ICE candidate from:", message.senderId);
        handleIceCandidate(message.senderId, message.data);
        break;
      case "ping":
        console.log("Received ping: ", message);
        break;
      default:
        console.log("Received unknown message:", message);
    }
  } catch (error) {
    console.error("Error parsing SSE message:", error);
  }
}

// --- 6. WebRTC Functions ---
function createPeerConnection(remotePeerId) {
  console.log("creating peer connection with ", remotePeerId);
  // console.log("RTCPeerConfiguration", { iceServers });
  peerConnections[remotePeerId] = new RTCPeerConnection({
    iceServers: [iceServers],
  });

  peerConnections[remotePeerId].onicecandidate = (event) => {
    if (event.candidate) {
      sendIceCandidate(remotePeerId, event.candidate);
    }
  };

  peerConnections[remotePeerId].ontrack = (event) => {
    console.log("ontrack event", event);
    if (event.streams && event.streams[0]) {
      addRemoteVideoStream(remotePeerId, event.streams[0]);
    } else {
      console.log("no stream");
    }
  };

  if (localStream) {
    localStream
      .getTracks()
      .forEach((track) =>
        peerConnections[remotePeerId].addTrack(track, localStream),
      );
  }
}

async function sendOffer(remotePeerId) {
  console.log("creating offer with ", remotePeerId);
  const offer = await peerConnections[remotePeerId].createOffer();
  await peerConnections[remotePeerId].setLocalDescription(offer);
  sendSignalingMessage(remotePeerId, "offer", offer);
}

async function handleOffer(remotePeerId, offer) {
  console.log("handling offer with ", remotePeerId);
  createPeerConnection(remotePeerId);
  await peerConnections[remotePeerId].setRemoteDescription(
    new RTCSessionDescription(offer),
  );
  const answer = await peerConnections[remotePeerId].createAnswer();
  await peerConnections[remotePeerId].setLocalDescription(answer);
  sendSignalingMessage(remotePeerId, "answer", answer);
}

async function handleAnswer(remotePeerId, answer) {
  console.log("handling answer with ", remotePeerId);
  await peerConnections[remotePeerId].setRemoteDescription(
    new RTCSessionDescription(answer),
  );
}

async function handleIceCandidate(remotePeerId, iceCandidate) {
  try {
    console.log("handling ice candidate with ", remotePeerId);
    await peerConnections[remotePeerId].addIceCandidate(
      new RTCIceCandidate(iceCandidate),
    );
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
  const registrationSuccess = await registerWithServer(); // Register first
  if (registrationSuccess) {
    await startLocalStream();
    createPeerConnection("ownPeer");
    connectToSignalingServer();
  } else {
    console.error("Failed to register, cannot start stream.");
  }
}

// --- 7. Control Functions ---
startStopButton.onclick = async () => {
  if (isStreaming) {
    stopLocalStream();
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

function updateStats() {
  if (localStream && localStream.getVideoTracks().length > 0) {
    const videoTrack = localStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    localResolutionDisplay.textContent = `${settings.width}x${settings.height}`;

    //This is a basic implementation.  A full implementation would require RTCRtpSender.getStats()
    localBitrateDisplay.textContent = "calculating...";
  }
  setTimeout(updateStats, 1000); // Refresh every 1 second
}

// --- 7. Session Management ---
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

// --- 8. Start WebRTC ---
// async function startWebRTC() {
//   await getIceServers();
//The code has already got the media before. Removed awaiting the media to get the code flow to work
//await startLocalStream();
// }

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
    statsDiv.innerHTML = `<p>Resolution: <span id="remoteResolution_${peerId}"></span></p><p>Bitrate: <span id="remoteBitrate_${peerId}"></span> kbps</p>`;

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
      });
    } catch (e) {
      console.error("Error getting remote stats", e);
    }
  }
}

// Initialize -  Wait for user to enter session information
//connectToSignalingServer();
//startWebRTC();

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
