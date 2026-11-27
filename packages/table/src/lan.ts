/**
 * Playing on the DM's network with no internet (ADR 0006). The DM and the player swap WebRTC descriptions through
 * QR codes (or text), then talk over one data channel with no server, STUN or relay. Scanning a code is the
 * authentication: each description carries its device's certificate fingerprint.
 */
import type { TableLink } from "./link.js";

export const LAN_CODE_PREFIX = "MB-LAN1.";
/** The identity players give the host on a local-network link; invites made for local play name it as the host. */
export const LAN_HOST = "lan-host";
/** Browsers limit data channel messages; larger messages are split into frames of this many characters. */
export const FRAME_SIZE = 16000;
const MAX_MESSAGE = 8_000_000;
const GATHER_TIMEOUT_MS = 4000;

export interface LanOffer {
  k: "offer";
  sdp: string;
  campaign: string;
  /** The campaign key, as an invite link carries it: the player says hello with it. */
  key: string;
}

export interface LanAnswer {
  k: "answer";
  sdp: string;
  /** The player's device id for local play, kept by the player app so the same device rejoins as the same member. */
  player: string;
}

export class LanCodeError extends Error {}

const toBase64Url = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeLanCode(payload: LanOffer | LanAnswer): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream("deflate-raw"));
  return LAN_CODE_PREFIX + toBase64Url(packed);
}

/** Finds a code inside any text, such as a shared message. */
export function lanCodeFrom(text: string): string | null {
  const m = new RegExp(`${LAN_CODE_PREFIX.replace(".", "\\.")}[A-Za-z0-9_-]+`).exec(text);
  return m ? m[0] : null;
}

export async function decodeLanCode(text: string, expected: "offer"): Promise<LanOffer>;
export async function decodeLanCode(text: string, expected: "answer"): Promise<LanAnswer>;
export async function decodeLanCode(text: string, expected: "offer" | "answer"): Promise<LanOffer | LanAnswer> {
  const code = lanCodeFrom(text);
  if (!code) throw new LanCodeError(expected === "offer" ? "That isn't a code from a DM's Mimic Box." : "That isn't a reply code from a player's Mimic Box.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(await pipe(fromBase64Url(code.slice(LAN_CODE_PREFIX.length)), new DecompressionStream("deflate-raw"))));
  } catch {
    throw new LanCodeError("That code is damaged. Scan it again, or copy all of it.");
  }
  const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (raw.k !== expected) {
    throw new LanCodeError(expected === "offer" ? "That's a player's reply code. Scan the code on the DM's screen instead." : "That's the DM's own code. Scan the reply code on the player's phone instead.");
  }
  if (!str(raw.sdp, 20000) || !/^v=0\r?\n/.test(raw.sdp as string)) throw new LanCodeError("That code is damaged. Scan it again, or copy all of it.");
  if (expected === "offer") {
    if (!str(raw.campaign, 120) || !str(raw.key, 100)) throw new LanCodeError("That code is incomplete. Ask the DM for a new one.");
    return { k: "offer", sdp: raw.sdp as string, campaign: raw.campaign as string, key: raw.key as string };
  }
  if (!str(raw.player, 64) || !/^[\w-]+$/.test(raw.player as string)) throw new LanCodeError("That reply code is incomplete. Ask the player to join again.");
  return { k: "answer", sdp: raw.sdp as string, player: raw.player as string };
}

/** Splits a message into frames "id|index|count|part". */
export function splitFrames(text: string, id: string): string[] {
  const count = Math.max(1, Math.ceil(text.length / FRAME_SIZE));
  return Array.from({ length: count }, (_, i) => `${id}|${i}|${count}|${text.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE)}`);
}

/** Puts frames back together. Returns the whole message once its last frame arrives; ignores anything malformed. */
export class FrameJoiner {
  private parts = new Map<string, { count: number; got: number; parts: string[] }>();

  push(frame: string): string | null {
    const m = /^([\w-]{1,40})\|(\d{1,4})\|(\d{1,4})\|/.exec(frame);
    if (!m) return null;
    const [head, id, i, n] = m;
    const index = Number(i);
    const count = Number(n);
    if (count < 1 || index >= count || count * FRAME_SIZE > MAX_MESSAGE) return null;
    const body = frame.slice(head.length);
    if (count === 1) return body;
    let entry = this.parts.get(id!);
    if (!entry || entry.count !== count) {
      // One message is assembled at a time per id; a few stale ones are dropped so memory stays bounded.
      if (this.parts.size > 8) this.parts.delete(this.parts.keys().next().value!);
      entry = { count, got: 0, parts: new Array<string>(count) };
      this.parts.set(id!, entry);
    }
    if (entry.parts[index] === undefined) entry.got++;
    entry.parts[index] = body;
    if (entry.got < count) return null;
    this.parts.delete(id!);
    return entry.parts.join("");
  }
}

/** One local-network connection: JSON messages over a framed data channel. */
export interface LanPeer {
  send: (msg: unknown) => void;
  /** Handlers registered after the channel opened, or after messages arrived, still get them. */
  onOpen: (handler: () => void) => void;
  onMessage: (handler: (msg: unknown) => void) => void;
  onClose: (handler: () => void) => void;
  isOpen: () => boolean;
  close: () => void;
}

function framedPeer(pc: RTCPeerConnection, channel: Promise<RTCDataChannel>): LanPeer {
  let ch: RTCDataChannel | null = null;
  let open = false;
  let closed = false;
  let seq = 0;
  const joiner = new FrameJoiner();
  const opens: (() => void)[] = [];
  const closes: (() => void)[] = [];
  let messages: ((m: unknown) => void) | null = null;
  const early: unknown[] = [];
  const finish = () => {
    if (closed) return;
    closed = true;
    open = false;
    for (const h of closes) h();
  };
  void channel.then((c) => {
    ch = c;
    const ready = () => {
      if (open || closed) return;
      open = true;
      for (const h of opens) h();
    };
    if (c.readyState === "open") ready();
    c.onopen = ready;
    c.onclose = finish;
    c.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const whole = joiner.push(e.data);
      if (whole === null) return;
      let msg: unknown;
      try {
        msg = JSON.parse(whole);
      } catch {
        return;
      }
      if (messages) messages(msg);
      else early.push(msg);
    };
  });
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") finish();
  };
  return {
    send: (msg) => {
      if (!ch || ch.readyState !== "open") return;
      for (const f of splitFrames(JSON.stringify(msg), `m${++seq}`)) ch.send(f);
    },
    onOpen: (h) => {
      opens.push(h);
      if (open) h();
    },
    onMessage: (h) => {
      messages = h;
      for (const m of early.splice(0)) h(m);
    },
    onClose: (h) => {
      closes.push(h);
      if (closed) h();
    },
    isOpen: () => open,
    close: () => {
      ch?.close();
      pc.close();
      finish();
    },
  };
}

/** Waits until the browser has listed its network addresses, so the description is complete without trickling. */
async function gathered(pc: RTCPeerConnection): Promise<string> {
  if (pc.iceGatheringState !== "complete") {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, GATHER_TIMEOUT_MS);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }
  return pc.localDescription!.sdp;
}

/** The DM's side: makes a code for one player, then connects once the player's reply is given. */
export async function startLanHost(campaign: string, key: string): Promise<{ code: string; peer: LanPeer; accept: (reply: string) => Promise<LanAnswer> }> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channel = pc.createDataChannel("mimicbox", { ordered: true });
  const peer = framedPeer(pc, Promise.resolve(channel));
  await pc.setLocalDescription(await pc.createOffer());
  const code = await encodeLanCode({ k: "offer", sdp: await gathered(pc), campaign, key });
  return {
    code,
    peer,
    accept: async (reply) => {
      const answer = await decodeLanCode(reply, "answer");
      try {
        await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      } catch {
        throw new LanCodeError("That reply doesn't match this code. Ask the player to scan the code on your screen again.");
      }
      return answer;
    },
  };
}

/** The player's side: reads the DM's code and makes the reply. The link opens once the DM scans the reply. */
export async function joinLan(code: string, player: string): Promise<{ offer: LanOffer; reply: string; peer: LanPeer }> {
  const offer = await decodeLanCode(code, "offer");
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channel = new Promise<RTCDataChannel>((resolve) => (pc.ondatachannel = (e) => resolve(e.channel)));
  const peer = framedPeer(pc, channel);
  try {
    await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp });
  } catch {
    pc.close();
    throw new LanCodeError("That code is damaged. Scan it again, or copy all of it.");
  }
  await pc.setLocalDescription(await pc.createAnswer());
  const reply = await encodeLanCode({ k: "answer", sdp: await gathered(pc), player });
  return { offer, reply, peer };
}

/** A player's local-network connection to the DM, as the same TableLink the online path gives. */
export function lanLink(peer: LanPeer, self: string): TableLink {
  return {
    self: async () => self,
    send: (msg) => peer.send(msg),
    onMessage: (h) => peer.onMessage((m) => h(m, LAN_HOST)),
    // Only openings after this call: one that already happened shows in connected().
    onJoin: (h) => {
      if (!peer.isOpen()) peer.onOpen(() => h(LAN_HOST));
    },
    onLeave: (h) => peer.onClose(() => h(LAN_HOST)),
    connected: () => (peer.isOpen() ? [LAN_HOST] : []),
    leave: async () => peer.close(),
  };
}
