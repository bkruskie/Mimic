# ADR 0006: Playing on the DM's network with no internet: QR code handshake

Date: 2026-11-26. Status: accepted.

## Context

Phase 4 asks for play that needs no internet, for a group around the DM's table. ADR 0004 meets players through public signalling relays, which need the internet. ADR 0005 hosts from a browser page, and a browser page can't run a server, so the plan's original fallback (the host serving the app and a WebSocket on the home network) isn't possible until there is a desktop app.

WebRTC doesn't need a server once two devices have swapped their connection descriptions (SDP). On one network the descriptions contain local addresses, so the devices connect without STUN or a relay. All that's missing is a way to swap the descriptions.

## Decision

- The DM and the player swap descriptions through QR codes, one each way:
  1. The DM chooses "Add a player without internet" and shows a code. It holds the DM's offer, the campaign name and the campaign key (the same secret an invite link carries).
  2. The player scans it in "Join on the DM's network" and gets a reply code. The reply holds the player's answer and a device id that the player app keeps.
  3. The DM scans the reply, and the two devices connect directly.
- Every code also exists as text, for a device without a camera. The text can be pasted, shared with AirDrop or Nearby Share (which work offline), or sent through any chat app.
- QR codes are read with the browser's `BarcodeDetector` where it exists, and otherwise with jsQR (Apache-2.0). jsQR is loaded only when a camera opens.
- A code is compressed JSON (`deflate-raw`, then base64url) behind a `MB-LAN1.` prefix. Scanning a code is the authentication: each description carries its device's certificate fingerprint, so nobody else on the network can step in. The player still says hello with the campaign key, so the host's checks are unchanged.
- The connection is a plain `RTCPeerConnection` with no ICE servers and one data channel. Messages are split into 16 KB frames, because browsers limit the size of a data channel message and handout pictures and map tiles are larger.
- The host treats a local-network player like any other connection: it uses the same `handlePlayerMessage`, the same per-player views, the same pictures and tiles.

## Consequences

- A group with no internet can play, as long as the DM's computer and the players' phones are on the same Wi-Fi network (even a phone hotspot without data) and each device has opened Mimic Box once while online.
- The DM's computer needs a camera, or the player sends their reply as text. Laptops nearly always have a camera.
- A dropped local-network connection doesn't reconnect by itself; the player scans a new code from the DM. Commands the player made while disconnected wait in the outbox, as they do online.
- A player who joins once online and once on the local network appears as two party members, because the two use different device ids. The DM can remove the older one.
- A desktop app could later serve the app and accept connections without the handshake; it would reuse this transport's framing.
