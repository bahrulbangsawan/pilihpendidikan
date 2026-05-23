/**
 * Parse wilayah.sql and generate per-province TypeScript data files.
 * Run: bun run scripts/parse-wilayah.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SQL_PATH = join(ROOT, "wilayah.sql");
const OUT_DIR = join(ROOT, "src/data/wilayah");

interface Entry {
  kode: string;
  nama: string;
}

// Parse all (kode, nama) pairs from the SQL file
const sql = readFileSync(SQL_PATH, "utf-8");
const regex = /\('([^']+)','([^']*(?:''[^']*)*)'\)/g;
const entries: Array<Entry> = [];

let match: RegExpExecArray | null;
while ((match = regex.exec(sql)) !== null) {
  entries.push({
    kode: match[1],
    nama: match[2].replace(/''/g, "'"),
  });
}

console.log(`Parsed ${entries.length} entries`);

// Categorize by hierarchy level based on dot-separated code segments
const provinces: Array<Entry> = [];
const byProvince = new Map<
  string,
  { kabupaten: Array<Entry>; kecamatan: Array<Entry>; kelurahan: Array<Entry> }
>();

for (const entry of entries) {
  const dots = entry.kode.split(".").length - 1;

  if (dots === 0) {
    // Province: 2-digit code (no dots)
    provinces.push(entry);
    byProvince.set(entry.kode, {
      kabupaten: [],
      kecamatan: [],
      kelurahan: [],
    });
  } else {
    const provinceCode = entry.kode.split(".")[0];
    const bucket = byProvince.get(provinceCode);
    if (!bucket) {
      continue;
    }

    if (dots === 1) {
      bucket.kabupaten.push(entry);
    } else if (dots === 2) {
      bucket.kecamatan.push(entry);
    } else if (dots === 3) {
      bucket.kelurahan.push(entry);
    }
  }
}

console.log(`Provinces: ${provinces.length}`);
console.log(`Province chunks to generate: ${byProvince.size}`);

// Ensure output directory exists
mkdirSync(OUT_DIR, { recursive: true });

// Generate provinces.ts
const provincesContent = `// Auto-generated from wilayah.sql — do not edit manually
import type { WilayahEntry } from "./index"

export const provinces: WilayahEntry[] = ${JSON.stringify(
  provinces.map((p) => ({ kode: p.kode, nama: p.nama })),
  null,
  2
)}
`;
writeFileSync(join(OUT_DIR, "provinces.ts"), provincesContent);
console.log(`Generated provinces.ts (${provinces.length} entries)`);

// Generate per-province chunk files
let totalKab = 0;
let totalKec = 0;
let totalKel = 0;

for (const [code, data] of byProvince) {
  totalKab += data.kabupaten.length;
  totalKec += data.kecamatan.length;
  totalKel += data.kelurahan.length;

  const content = `// Auto-generated from wilayah.sql — do not edit manually
import type { ProvinceData } from "./index"

const data: ProvinceData = {
  kabupaten: ${JSON.stringify(data.kabupaten, null, 2)},
  kecamatan: ${JSON.stringify(data.kecamatan, null, 2)},
  kelurahan: ${JSON.stringify(data.kelurahan, null, 2)},
}

export default data
`;
  writeFileSync(join(OUT_DIR, `${code}.ts`), content);
}

console.log(
  `Generated ${byProvince.size} province files (${totalKab} kab, ${totalKec} kec, ${totalKel} kel)`
);
console.log("Done!");
