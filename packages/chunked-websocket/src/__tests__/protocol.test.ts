import { describe, expect, it } from "vitest";
import {
  CHUNK_MAX_SIZE,
  RESET_SENTINEL,
  handleChunked,
  parseBatchMarker,
  sendChunked,
  type ChunkedMessageData,
} from "../protocol.js";

describe("chunked-websocket protocol", () => {
  it("generates non-empty distinct batch IDs without float addition precision loss", () => {
    const frames: ChunkedMessageData[] = [];
    const payload = new Uint8Array(CHUNK_MAX_SIZE + 10);
    const origRandom = Math.random;
    try {
      // Regression: `(Date.now() + Math.random()).toString(36).substring(10)`
      // lost 41 of the 53 mantissa bits and produced `""` when Math.random() === 0.5.
      Math.random = () => 0.5;
      sendChunked(payload.buffer, { send: (d: ChunkedMessageData) => frames.push(d) });
      Math.random = () => 0.5 + 1e-12;
      sendChunked(payload.buffer, { send: (d: ChunkedMessageData) => frames.push(d) });
    } finally {
      Math.random = origRandom;
    }

    const start1 = parseBatchMarker(frames[0] as string);
    const end1 = parseBatchMarker(frames[3] as string);
    const start2 = parseBatchMarker(frames[4] as string);
    expect(start1.id.length).toBeGreaterThan(0);
    expect(start1.id).toBe(end1.id);
    expect(start2.id.length).toBeGreaterThan(0);
    expect(start1.id).not.toBe(start2.id);
  });

  it("reassembles multi-chunk payloads and recovers across RESET_SENTINEL", () => {
    const received: ChunkedMessageData[] = [];
    const handler = handleChunked((data) => received.push(data));

    const frames: ChunkedMessageData[] = [];
    const payload = new Uint8Array(CHUNK_MAX_SIZE * 2 + 123);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) & 0xff;

    sendChunked(payload.buffer, { send: (d: ChunkedMessageData) => frames.push(d) });
    expect(frames.length).toBe(5); // start + 3 chunks + end

    // Simulate interrupted batch followed by RESET_SENTINEL and then full batch
    handler({ data: frames[0]! }); // start
    handler({ data: frames[1]! }); // chunk 0
    handler({ data: RESET_SENTINEL }); // reset -> enter DRAIN
    handler({ data: frames[2]! }); // stray chunk 1 (drained)
    expect(received.length).toBe(0);

    // Fresh batch recovers cleanly
    for (const f of frames) {
      handler({ data: f });
    }
    expect(received.length).toBe(1);
    expect(new Uint8Array(received[0] as ArrayBuffer)).toEqual(payload);
  });
});
