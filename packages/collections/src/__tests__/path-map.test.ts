/**
 * Unit tests for PathMap - the trie-based Map with structural key equality
 *
 * Tests internal mechanics:
 * - Trie root selection (flat/set/array keys)
 * - Canonical node/key resolution
 * - WeakRef behavior after delete
 * - Insertion order preservation
 * - Size tracking accuracy
 */

import { describe, expect, it } from "vitest";

import { PathMap } from "../path-map.js";

describe("PathMap", () => {
  describe("basic Map operations", () => {
    it("should implement full Map interface", () => {
      const map = new PathMap<string, number>();

      map.set("a", 1);
      map.set("b", 2);

      expect([map.size, map.get("a"), map.get("b"), map.has("a"), map.has("c")]).to.have.ordered.members([
        2,
        1,
        2,
        true,
        false,
      ]);

      expect([map.delete("a"), map.delete("a"), map.size]).to.have.ordered.members([true, false, 1]); // First delete succeeds, second fails

      map.clear();
      expect(map).to.have.property("size", 0);
    });

    it("should have correct Symbol.toStringTag", () => {
      const map = new PathMap<string, number>();
      expect([map[Symbol.toStringTag], Object.prototype.toString.call(map)]).to.have.ordered.members([
        "PathMap",
        "[object PathMap]",
      ]);
    });

    it("should handle undefined values without corrupting size or storedEntries", () => {
      const map = new PathMap<string, number | undefined>();
      map.set("a", undefined);
      expect(map.has("a")).to.equal(true);
      expect(map.size).to.equal(1);
      map.set("a", 42);
      expect(map.size).to.equal(1);
      expect([...map.entries()]).to.deep.equal([["a", 42]]);
      map.set("a", undefined);
      expect(map.delete("a")).to.equal(true);
      expect(map.has("a")).to.equal(false);
      expect(map.size).to.equal(0);
    });
  });

  describe("trie root selection", () => {
    it("should use separate roots for flat, Set, and Array keys", () => {
      const map = new PathMap<string | Set<string> | string[], number>();

      // These should all be stored in different trie roots
      map.set("a", 1);
      map.set(new Set(["a"]), 2);
      map.set(["a"], 3);

      expect([map.size, map.get("a"), map.get(new Set(["a"])), map.get(["a"])]).to.have.ordered.members([3, 1, 2, 3]);
    });

    it("should not confuse empty containers with each other", () => {
      const map = new PathMap<Set<string> | string[], number>();

      map.set(new Set(), 1);
      map.set([], 2);

      expect([map.size, map.get(new Set()), map.get([])]).to.have.ordered.members([2, 1, 2]);
    });
  });

  describe("Set key canonicalization", () => {
    it("should treat Sets with same elements as equal regardless of order", () => {
      const map = new PathMap<Set<string>, number>();

      map.set(new Set(["a", "b", "c"]), 1);

      // Different insertion order, same canonical form
      expect([
        map.get(new Set(["c", "b", "a"])),
        map.get(new Set(["b", "a", "c"])),
        map.has(new Set(["a", "c", "b"])),
      ]).to.have.ordered.members([1, 1, true]);
    });

    it("should distinguish Sets with different elements", () => {
      const map = new PathMap<Set<string>, number>();

      map.set(new Set(["a", "b"]), 1);
      map.set(new Set(["a", "c"]), 2);

      expect([map.size, map.get(new Set(["a", "b"])), map.get(new Set(["a", "c"]))]).to.have.ordered.members([2, 1, 2]);
    });

    it("should treat Sets of objects with same members as equal regardless of order (ordinal-sorted)", () => {
      const map = new PathMap<Set<object>, number>();
      const a = {};
      const b = {};
      const c = {};

      map.set(new Set([a, b, c]), 1);

      // Different insertion order, same canonical form — exercises the
      // object branch of the trie's set-key sort (`ordinal.id`-based).
      expect([
        map.get(new Set([c, b, a])),
        map.get(new Set([b, a, c])),
        map.has(new Set([a, c, b])),
      ]).to.have.ordered.members([1, 1, true]);
    });
  });

  describe("Array key ordering", () => {
    it("should treat Arrays as order-sensitive", () => {
      const map = new PathMap<string[], number>();

      map.set(["a", "b"], 1);
      map.set(["b", "a"], 2);

      expect([map.size, map.get(["a", "b"]), map.get(["b", "a"])]).to.have.ordered.members([2, 1, 2]);
    });

    it("should treat identical Arrays as equal", () => {
      const map = new PathMap<number[], string>();

      map.set([1, 2, 3], "first");

      expect([map.get([1, 2, 3]), map.has([1, 2, 3])]).to.have.ordered.members(["first", true]);
    });
  });

  describe("canonical key resolution", () => {
    it("should return stable canonical key for Set keys", () => {
      const map = new PathMap<Set<string>, number>();

      const key1 = new Set(["a", "b"]);
      map.set(key1, 1);

      const canonical1 = map.getCanonicalKey(key1);
      const canonical2 = map.getCanonicalKey(new Set(["b", "a"]));

      // Same canonical key object
      expect(canonical1).to.equal(canonical2);
    });

    it("should return stable canonical key for Array keys", () => {
      const map = new PathMap<number[], string>();

      map.set([1, 2], "value");

      const canonical1 = map.getCanonicalKey([1, 2]);
      const canonical2 = map.getCanonicalKey([1, 2]);

      // Same canonical key object and frozen
      expect(canonical1).to.equal(canonical2);
      expect(Object.isFrozen(canonical1)).to.eq(true);
    });

    it("should create canonical key on getCanonicalKey even for missing keys", () => {
      const map = new PathMap<Set<string>, number>();

      // Key doesn't exist but getCanonicalKey creates canonical form
      const canonical = map.getCanonicalKey(new Set(["x", "y"]));

      expect(canonical).to.be.instanceOf(Set);
      expect([...canonical]).to.have.ordered.members(["x", "y"]);
    });

    it("should preserve canonical key identity when set follows getCanonicalKey", () => {
      const map = new PathMap<Set<string>, number>();

      const canonicalBefore = map.getCanonicalKey(new Set(["a", "b"]));
      map.set(new Set(["b", "a"]), 1);
      const canonicalAfter = map.getCanonicalKey(new Set(["a", "b"]));

      expect(canonicalAfter).to.equal(canonicalBefore);
      expect([...map.keys()][0]).to.equal(canonicalBefore);
    });
  });

  describe("delete and WeakRef behavior", () => {
    it("should reuse live WeakRef canonical key when re-inserting after delete", () => {
      const map = new PathMap<Set<string>, number>();

      map.set(new Set(["a", "b"]), 1);
      const canonical1 = map.getCanonicalKey(new Set(["a", "b"]));

      map.delete(new Set(["b", "a"]));
      map.set(new Set(["b", "a"]), 2);

      const canonical2 = map.getCanonicalKey(new Set(["a", "b"]));
      expect(canonical2).to.equal(canonical1);
      expect([...map.keys()][0]).to.equal(canonical1);
    });

    it("should remove from iteration after delete", () => {
      const map = new PathMap<string, number>();

      map.set("a", 1);
      map.set("b", 2);
      map.set("c", 3);

      map.delete("b");

      const keys = [...map.keys()];
      expect(keys).to.have.lengthOf(2).and.include.members(["a", "c"]).and.not.include("b");
    });

    it("should update size correctly on delete", () => {
      const map = new PathMap<string, number>();

      map.set("a", 1);
      map.set("b", 2);
      const sizeBefore = map.size;

      map.delete("a");
      const sizeAfterDelete = map.size;

      map.delete("nonexistent");
      const sizeAfterNoOp = map.size;

      expect([sizeBefore, sizeAfterDelete, sizeAfterNoOp]).to.have.ordered.members([2, 1, 1]);
    });
  });

  describe("iteration order", () => {
    it("should preserve insertion order in keys()", () => {
      const map = new PathMap<string, number>();

      map.set("c", 3);
      map.set("a", 1);
      map.set("b", 2);

      expect([...map.keys()]).to.have.ordered.members(["c", "a", "b"]);
    });

    it("should preserve insertion order in values()", () => {
      const map = new PathMap<string, number>();

      map.set("c", 3);
      map.set("a", 1);
      map.set("b", 2);

      expect([...map.values()]).to.have.ordered.members([3, 1, 2]);
    });

    it("should preserve insertion order in entries()", () => {
      const map = new PathMap<string, number>();

      map.set("c", 3);
      map.set("a", 1);
      map.set("b", 2);

      expect([...map.entries()]).to.deep.equal([
        ["c", 3],
        ["a", 1],
        ["b", 2],
      ]);
    });

    it("should work with forEach", () => {
      const map = new PathMap<string, number>();

      map.set("x", 10);
      map.set("y", 20);

      const collected: [string, number][] = [];
      for (const [key, value] of map.entries()) {
        collected.push([key, value]);
      }

      expect(collected).to.deep.equal([
        ["x", 10],
        ["y", 20],
      ]);
    });

    it("should support Symbol.iterator", () => {
      const map = new PathMap<string, number>();

      map.set("a", 1);
      map.set("b", 2);

      const entries = [...map];
      expect(entries).to.deep.equal([
        ["a", 1],
        ["b", 2],
      ]);
    });
  });

  describe("update existing keys", () => {
    it("should update value without changing size", () => {
      const map = new PathMap<string, number>();

      map.set("key", 1);
      const sizeBefore = map.size;

      map.set("key", 2);

      expect([sizeBefore, map.size, map.get("key")]).to.have.ordered.members([1, 1, 2]);
    });

    it("should keep same canonical key on update", () => {
      const map = new PathMap<Set<string>, number>();

      const key = new Set(["a", "b"]);
      map.set(key, 1);
      const canonical1 = map.getCanonicalKey(key);

      map.set(new Set(["b", "a"]), 2);
      const canonical2 = map.getCanonicalKey(key);

      expect(canonical1).to.equal(canonical2);
      expect(map.get(key)).to.equal(2);
    });
  });

  describe("mixed key types in containers", () => {
    it("should handle Set with mixed primitive types", () => {
      const map = new PathMap<Set<string | number | boolean>, string>();

      const key = new Set<string | number | boolean>(["a", 1, true]);
      map.set(key, "mixed");

      // Same elements, different object
      expect(map.get(new Set([true, "a", 1]))).to.equal("mixed");
    });

    it("should handle Array with mixed primitive types", () => {
      const map = new PathMap<(string | number | null)[], string>();

      map.set(["a", 1, null], "mixed");

      // Same order = same key, different order = different key
      expect([map.get(["a", 1, null]), map.get([1, "a", null])]).to.have.ordered.members(["mixed", undefined]);
    });
  });

  describe("null handling", () => {
    it("should support null as a primitive key", () => {
      const map = new PathMap<string | null, number>();

      map.set(null, 1);
      map.set("null", 2); // String "null" is different

      expect([map.size, map.get(null), map.get("null")]).to.have.ordered.members([2, 1, 2]);
    });

    it("should support null in Set keys", () => {
      const map = new PathMap<Set<string | null>, number>();

      map.set(new Set([null, "a"]), 1);

      expect(map.get(new Set(["a", null]))).to.equal(1);
    });
  });

  describe("special numeric values", () => {
    it("should handle Infinity as key", () => {
      const map = new PathMap<number, string>();

      map.set(Infinity, "pos");
      map.set(-Infinity, "neg");

      expect([map.size, map.get(Infinity), map.get(-Infinity)]).to.have.ordered.members([2, "pos", "neg"]);
    });

    it("should handle NaN as key (same identity)", () => {
      const map = new PathMap<number, string>();

      map.set(Number.NaN, "first");
      map.set(Number.NaN, "second"); // Same key

      expect([map.size, map.get(Number.NaN)]).to.have.ordered.members([1, "second"]);
    });

    it("should handle BigInt as key", () => {
      const map = new PathMap<bigint, string>();

      map.set(123n, "small");
      map.set(999_999_999_999_999_999_999_999n, "large");

      expect([map.size, map.get(123n), map.get(999_999_999_999_999_999_999_999n)]).to.have.ordered.members([
        2,
        "small",
        "large",
      ]);
    });
  });
});
