// biome-ignore-all lint/suspicious/noBitwiseOperators: SHA-256 is defined on 32-bit words (FIPS 180-4); the bit operations are the algorithm.
// Incremental SHA-256 (FIPS 180-4) for runtimes without `crypto.DigestStream`
// (bun test, Node). Workers use DigestStream (inspect.ts); this keeps the
// upload path streaming everywhere — WebCrypto's one-shot digest would need
// the whole body in memory. Verified against WebCrypto in the files tests.

const K = new Uint32Array([
  0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b,
  0x59_f1_11_f1, 0x92_3f_82_a4, 0xab_1c_5e_d5, 0xd8_07_aa_98, 0x12_83_5b_01,
  0x24_31_85_be, 0x55_0c_7d_c3, 0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7,
  0xc1_9b_f1_74, 0xe4_9b_69_c1, 0xef_be_47_86, 0x0f_c1_9d_c6, 0x24_0c_a1_cc,
  0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da, 0x98_3e_51_52,
  0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47,
  0x06_ca_63_51, 0x14_29_29_67, 0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc,
  0x53_38_0d_13, 0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85,
  0xa2_bf_e8_a1, 0xa8_1a_66_4b, 0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19,
  0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70, 0x19_a4_c1_16, 0x1e_37_6c_08,
  0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a, 0x5b_9c_ca_4f,
  0x68_2e_6f_f3, 0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08,
  0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2,
]);

const INITIAL = [
  0x6a_09_e6_67, 0xbb_67_ae_85, 0x3c_6e_f3_72, 0xa5_4f_f5_3a, 0x51_0e_52_7f,
  0x9b_05_68_8c, 0x1f_83_d9_ab, 0x5b_e0_cd_19,
];

const BLOCK = 64;

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export class Sha256 {
  readonly #h = new Uint32Array(INITIAL);
  readonly #w = new Uint32Array(64);
  readonly #block = new Uint8Array(BLOCK);
  #blockLength = 0;
  #bytes = 0;
  #finished = false;

  #compress(block: Uint8Array): void {
    const w = this.#w;
    for (let i = 0; i < 16; i++) {
      w[i] =
        (block[i * 4] << 24) |
        (block[i * 4 + 1] << 16) |
        (block[i * 4 + 2] << 8) |
        block[i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    const h = this.#h;
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }

  update(data: Uint8Array): this {
    if (this.#finished) {
      throw new Error("Sha256: update after digest");
    }
    this.#bytes += data.length;
    let offset = 0;
    if (this.#blockLength > 0) {
      const take = Math.min(BLOCK - this.#blockLength, data.length);
      this.#block.set(data.subarray(0, take), this.#blockLength);
      this.#blockLength += take;
      offset = take;
      if (this.#blockLength < BLOCK) {
        return this;
      }
      this.#compress(this.#block);
      this.#blockLength = 0;
    }
    for (; offset + BLOCK <= data.length; offset += BLOCK) {
      this.#compress(data.subarray(offset, offset + BLOCK));
    }
    if (offset < data.length) {
      this.#block.set(data.subarray(offset), 0);
      this.#blockLength = data.length - offset;
    }
    return this;
  }

  /** The digest as lowercase hex; the hasher cannot be updated afterwards. */
  hex(): string {
    if (this.#finished) {
      throw new Error("Sha256: digest twice");
    }
    this.#finished = true;
    const bitLength = this.#bytes * 8;
    const padLength =
      this.#blockLength < 56 ? 56 - this.#blockLength : 120 - this.#blockLength;
    const tail = new Uint8Array(padLength + 8);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(padLength, Math.floor(bitLength / 2 ** 32));
    view.setUint32(padLength + 4, bitLength >>> 0);
    this.#finished = false;
    this.update(tail);
    this.#finished = true;
    let out = "";
    for (const word of this.#h) {
      out += (word >>> 0).toString(16).padStart(8, "0");
    }
    return out;
  }
}
