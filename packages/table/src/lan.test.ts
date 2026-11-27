import { describe, expect, it } from "vitest";
import { decodeLanCode, encodeLanCode, FRAME_SIZE, FrameJoiner, LanCodeError, lanCodeFrom, splitFrames } from "./index.js";

const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 AB:CD\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" + "a=candidate:1 1 udp 2113937151 abc.local 54321 typ host\r\n".repeat(3);

describe("local-network codes", () => {
  it("round-trip offers and replies, and are short enough for a QR code", async () => {
    const code = await encodeLanCode({ k: "offer", sdp: SDP, campaign: "The Sunken Bell", key: "k".repeat(32) });
    expect(code.startsWith("MB-LAN1.")).toBe(true);
    expect(code.length).toBeLessThan(1200);
    expect(await decodeLanCode(`Join my game: ${code} (from Mimic Box)`, "offer")).toEqual({ k: "offer", sdp: SDP, campaign: "The Sunken Bell", key: "k".repeat(32) });
    const reply = await encodeLanCode({ k: "answer", sdp: SDP, player: "lan-abc123" });
    expect((await decodeLanCode(reply, "answer")).player).toBe("lan-abc123");
  });

  it("say plainly what's wrong with a bad code", async () => {
    const offer = await encodeLanCode({ k: "offer", sdp: SDP, campaign: "C", key: "k" });
    await expect(decodeLanCode(offer, "answer")).rejects.toThrow(/DM's own code/);
    await expect(decodeLanCode("hello", "offer")).rejects.toBeInstanceOf(LanCodeError);
    await expect(decodeLanCode(offer.slice(0, -10) + "AAAAAAAAAA", "offer")).rejects.toThrow(/damaged|incomplete/);
    await expect(decodeLanCode(await encodeLanCode({ k: "answer", sdp: SDP, player: "a b" }), "answer")).rejects.toThrow(/incomplete/);
    expect(lanCodeFrom("nothing here")).toBeNull();
  });
});

describe("frames", () => {
  it("split large messages and put them back together, in any order", () => {
    const text = JSON.stringify({ data: "x".repeat(FRAME_SIZE * 3 + 5) });
    const frames = splitFrames(text, "m1");
    expect(frames).toHaveLength(4);
    const j = new FrameJoiner();
    expect([frames[2], frames[0], frames[3]].map((f) => j.push(f!))).toEqual([null, null, null]);
    expect(j.push(frames[1]!)).toBe(text);
    expect(new FrameJoiner().push(splitFrames("{}", "m2")[0]!)).toBe("{}");
  });

  it("ignore malformed and oversized frames", () => {
    const j = new FrameJoiner();
    expect(j.push("garbage")).toBeNull();
    expect(j.push("m1|5|2|x")).toBeNull();
    expect(j.push("m1|0|9999|x")).toBeNull();
  });
});
