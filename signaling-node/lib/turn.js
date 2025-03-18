const https = require("https");
const axios = require("axios");

const httpsAgent = new https.Agent({
  family: 4, // Force IPv4
});

// Cloudflare TURN configuration (replace with your actual values)
const TURN_KEY_ID = "7341540480fe621fc4e6267e9a55ec49";
const TURN_KEY_API_TOKEN =
  "b67ff493c47f78b89133bd1e3d6cb1aad05b9d21751256e75336534905f6e74c";

async function getIceServers() {
  try {
    const { status, data } = await axios.post(
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

    if (status === 201 || status === 200) {
      const { iceServers } = data;
      // console.log("ICE servers", iceServers);
      return iceServers;
    } else {
      console.error("Failed to get ICE servers");
      return null;
    }
  } catch (err) {
    console.error(err);
    return null;
  }
}

module.exports.getIceServers = getIceServers;
