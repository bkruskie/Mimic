# ADR 0004: No servers; devices meet through public signalling networks

Date: 2026-11-26. Status: accepted. Supersedes the Cloudflare broker in ADR 0003.

## Context

Players' devices must reach the DM's computer over the internet. WebRTC connects them directly, but the two devices first have to exchange connection details (signalling). The earlier plan ran a small signalling service and a relay on Cloudflare's free tier. The owner wants nothing that needs an account to set up or run, and is not experienced with Cloudflare.

## Decision

- Mimic Box runs no servers and no project account.
- Signalling goes over existing free public networks: Nostr relays by default, with MQTT brokers and BitTorrent trackers as fallbacks, following the open-source Trystero library's room protocol (MIT). Several relays are used at once. Relay lists are settings.
- The room key, invite secret and host certificate fingerprint travel in the invite link's fragment, which never leaves the player's browser. Signalling messages are encrypted with the room key, and the player checks the host's fingerprint, so a hostile relay can neither read the introduction nor impersonate the host.
- Public STUN servers, which need no account, find direct paths through home routers.
- There is no hosted relay (TURN). A group may configure one it runs itself.
- Two fallbacks need nothing on the internet: the DM's local network (Phase 4) and manual connection codes by QR code or pasted text.
- The static apps are hosted on GitHub Pages.

## Consequences

- Nothing to set up, nothing to pay for, nothing that can send a bill.
- Some networks block direct connections (strict mobile carriers, some school and work Wi-Fi). Without a hosted relay those players must switch networks, join locally or use a group-run relay. The Phase 0 connectivity spike measures how often this happens; if it is common, a free relay option is revisited.
- Public relay operators can see that two devices met, their IP addresses and the timing, but not game data.
- Signalling depends on third-party relays staying up; using several at once across more than one network, plus the local and manual fallbacks, limits the impact.
- The Rust host must speak the same room protocol, natively or through the desktop app's web view; the Phase 0 spike decides which.
