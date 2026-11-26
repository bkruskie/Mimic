/**
 * The live link between devices. Devices meet through public Nostr relays (or a WebSocket relay the group runs)
 * using Trystero, then talk directly over encrypted WebRTC. Identities are device key pairs that Trystero checks
 * against each connection's certificate, so a `from` here can be trusted, unlike anything inside a message.
 */

export const APP_ID = "mimicbox-vtt";
const ACTION = "mb1";

export interface LinkOptions {
  room: string;
  /** Encrypts signalling; only devices with the key can find or join the room. */
  key: string;
  /** WebSocket relay addresses; leave empty to use the public Nostr relays. */
  relays?: string[];
}

export interface TableLink {
  /** This device's identity. */
  self: () => Promise<string>;
  /** Sends to one device (by identity), or to everyone in the room. */
  send: (msg: unknown, to?: string) => void;
  onMessage: (handler: (msg: unknown, from: string) => void) => void;
  onJoin: (handler: (userId: string) => void) => void;
  onLeave: (handler: (userId: string) => void) => void;
  /** Device identities currently connected. */
  connected: () => string[];
  leave: () => Promise<void>;
}

interface MinimalRoom {
  getSelf: () => Promise<{ userId: string }>;
  getUsers: () => Readonly<Record<string, { peerIds: string[] }>>;
  makeAction: (name: string) => { send: (data: never, options?: { target?: string | string[] }) => Promise<void>; onMessage: (handler: (data: unknown, ctx: { userId: string }) => void) => unknown };
  onUserJoin: (handler: (ctx: { userId: string }) => void) => unknown;
  onUserLeave: (handler: (ctx: { userId: string }) => void) => unknown;
  leave: () => Promise<void>;
}

export async function openLink(options: LinkOptions): Promise<TableLink> {
  const base = { appId: APP_ID, password: options.key };
  let room: MinimalRoom;
  if (options.relays?.length) {
    const { joinRoom } = await import("@trystero-p2p/ws-relay");
    room = joinRoom({ ...base, relayConfig: { urls: options.relays } }, options.room) as unknown as MinimalRoom;
  } else {
    const { joinRoom } = await import("trystero");
    room = joinRoom(base, options.room) as unknown as MinimalRoom;
  }
  const action = room.makeAction(ACTION);
  return {
    self: async () => (await room.getSelf()).userId,
    send: (msg, to) => {
      if (to) {
        const peers = room.getUsers()[to]?.peerIds ?? [];
        if (peers.length) void action.send(msg as never, { target: peers }).catch(() => undefined);
      } else void action.send(msg as never).catch(() => undefined);
    },
    onMessage: (handler) => void action.onMessage((data, ctx) => handler(data, ctx.userId)),
    onJoin: (handler) => void room.onUserJoin((ctx) => handler(ctx.userId)),
    onLeave: (handler) => void room.onUserLeave((ctx) => handler(ctx.userId)),
    connected: () => Object.keys(room.getUsers()),
    leave: () => room.leave(),
  };
}

/** The DM's own windows (a table display on a second screen) talk over a same-device channel instead. */
export function displayChannelName(campaignId: string): string {
  return `mimicbox-display:${campaignId}`;
}
