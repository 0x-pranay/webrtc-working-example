# Webrtc

## Sequence Diagram

### Using Socket.io

```mermaid

sequenceDiagram


 participant FE AS FE

  participant BE AS BE
  participant SS AS SignallingServer
  participant DEVICE

  FE->>BE: POST /live/create-stream-request
  BE->>SS: /create-session
  SS->>DEVICE: /notification/create


  FE->>+SS: socket.open()
  DEVICE->>+SS: socket.open()
  Note over SS: Creates offer and send to all peers. <br/> Creates webrtc connection <br/> relays tracks from device to each peers

  SS-->>FE: offerSdp
  SS-->>DEVICE: offerSdp
  FE-->>SS: answerSdp
  DEVICE-->>SS: answerSdp
  Note over FE: gathers Icecandidates
  Note over SS: gathers Icecandidates
  Note over DEVICE: gathers Icecandidates

  Note over FE,SS: exchange ice-candidates
  Note over SS,DEVICE: exchange ice-candidates

  FE ->>SS: /live/stop
  SS-->-DEVICE: socket.close()

  SS-->-FE: socket.close()

```

### using SSE

```mermaid

sequenceDiagram
 Actor User

 participant FE AS FE
  participant SS AS SignallingServer
  Actor User2
  # participant BE AS BE
  participant D AS Device / User2

  User->>FE: clicks start streams

  FE->> SS:  GET /iceServers
  SS-->>FE: {urls: [], username, credentials}
  User2->> SS:  GET /iceServers
  SS-->>User2: {urls: [], username, credentials}

  Note over FE: generates sessionId=session1 <br/> generates peerId=peer1
  Note over User2:  generates peerId=peer2
  FE->> SS: POST /register/:sessionId/:peerId
  Note over SS: 1.creates a session <br/> 2. if exists then add this new user/peer <br/>  notifity other peers using SSE event - "new-peer"
  SS-->>FE: session registered successfully

  Note over User2: Clicks on Join stream a sessionId <br/> on device will receive this via pushy



  FE ->>+SS: open SSE connection <br/> GET /events/:sessionId/:peerId
  User2->>SS: POST /register/:sessionId/:peerId
  SS-->>User2: session registered successfully
  SS -->> FE: event: { senderId: "peer2", type: "new-peer" }
  Note over FE: 1. starts local Stream <br/> 2. create a RTCPeerConnection <br/> 3. add local tracks to connection <br/> 4. attach onicecandidate and ontrack event listeners
  User2 ->>+SS: open SSE connection <br/> GET /events/:sessionId/:peerId
  Note over FE:  offer = pc.createOffer() <br/> setLocalDescription(offer)

  FE->> SS: POST /message/:sessionId/:peerId <br/> { target:"peer2", type: "offer", payload: offer}
  SS-->>FE: 200 {message: "Message sent" }
  SS-->>User2: event: { senderId: "peer1", type: "offer", payload }
  Note over User2: 1.create a RTCPeerConnection with this remote peer. <br/> setRemoteDescription(new RTCSessionDescription(offer)) <br/> createAnswer() <br/>setLocalDescription(answer)

   User2->> SS: POST /message/:sessionId/:peerId <br/> { target:"peer1", type: "answer", payload: answer}
   SS-->>User2: 200 {message: "Message sent" }
   SS-->>FE: event: { senderId: "peer2", type: "answer", payload }
   Note over FE: setRemoteDescription(new RTCSessionDescription(answer))

   loop iceGathering
     Note over FE: gathers ice-candidates from all transports <br/> pc.onicecandidate = (event) => sendMessage(event.candiadate)
     FE-->>SS: POST /message/session1/peer1 <br/> { target:"peer2", type: "ice-candidate", payload: candidate}
     SS-->>User2: event: { senderId: "peer1", type: "ice-candidate", payload: candidate}
     Note over User2: adds this ice candidate to the connection. <br/> peerConnections[remotePeerId].addIceCandidate(new RTCIceCandidate(candidate))

     Note over User2: gathers ice-candidates from all transports <br/> pc.onicecandidate = (event) => sendMessage(event.candiadate)
     User2-->>SS: POST /message/session1/peer2 <br/> { target:"peer1", type: "ice-candidate", payload: candidate}
     SS-->>FE: event: { senderId: "peer2", type: "ice-candidate", payload: candidate}
     Note over FE: adds this ice candidate to the connection. <br/> peerConnections[remotePeerId].addIceCandidate(new RTCIceCandidate(candidate))

   end

   Note over FE,User2: Webrtc connection starts


  SS->-User2: sse.close()
  SS->-FE: sse.close()

```

## API

api : <https://api-dt1-dev-aps1.lightmetrics.co:3478/>

Browser client: <https://api-dt1-dev-aps1.lightmetrics.co:3478/>

### GET /iceServers

Description: Get iceServers
Response:

```
{
 "urls": [
     "stun:stun.cloudflare.com:3478",
     "turn:turn.cloudflare.com:3478?transport=udp",
     "turn:turn.cloudflare.com:3478?transport=tcp",
     "turns:turn.cloudflare.com:5349?transport=tcp"
 ],
 "username": "g00e2b2824d2d1badbc66c1326f4812bac9445546493cff5e0f99b2b2c0a5023",
 "credential": "75b1e95be44b68eb9725a7ae72c0b8ec768047745ff60148f8d713e6ea4c0b47"
}
```

### POST /register/:sessionId/:peerId

Description:

1. Use this API to register/initiate a webrtc session
2. sessionId: a unique identifier for a session
3. peerId: an identifier to identify peers present in that session. [ ex: combination of (clientId, fleet and userId) for browser peers. for device it is (clientId, fleetId, and deviceId) ]
4. on BE, a session is created for the first time and if for the same sessionId another peerId registers then that peerId is registered for this existing session.
5. Sends a new-peer event to all SSE connected peers to this session.

### POST /message/:sessionId/:peerId

Request Body:

```
{
  type,
  payload,
  target
}
```

Description:

1. forwards these messages to the target peerId using existing SSE connection.
2. Can be used to forward offer, answer, ice-candidates

### GET /events/:sessionId/:peerId

Description: Open a server sent event connection to receive messages from other peers in the session via SSE.

```

## ping

{
 "time": "2025-02-14T11:19:47.726Z",
 "type": "ping"
}

## new-peer
{
 "type": "new-peer",
 "senderId": "",
}

## offer
{
 "type": "offer", // or "answer", "ice-candidate"
 "payload",
 "senderId": ""
}

```
