import { sha256 } from "./stable.mjs";

function seedWords(seed) {
  const digest = sha256(String(seed));
  return [0, 8, 16, 24].map((offset) => Number.parseInt(digest.slice(offset, offset + 8), 16) >>> 0);
}
export class SeededRandom {
  constructor(seed) {
    [this.a, this.b, this.c, this.d] = seedWords(seed);
  }

  nextUint32() {
    // sfc32: a small deterministic generator with an explicitly fixed 32-bit implementation.
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const result = (this.a + this.b + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = (((this.c << 21) | (this.c >>> 11)) + result) >>> 0;
    return result;
  }

  next() {
    return this.nextUint32() / 0x1_0000_0000;
  }

  integer(maxExclusive) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError("maxExclusive must be a positive safe integer");
    return Math.floor(this.next() * maxExclusive);
  }

  shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = this.integer(index + 1);
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  sample(values, count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > values.length) throw new RangeError("Invalid sample size");
    return this.shuffle(values).slice(0, count);
  }
}
