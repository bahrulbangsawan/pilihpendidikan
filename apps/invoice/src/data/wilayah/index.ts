export interface WilayahEntry {
  kode: string;
  nama: string;
}

export interface ProvinceData {
  kabupaten: Array<WilayahEntry>;
  kecamatan: Array<WilayahEntry>;
  kelurahan: Array<WilayahEntry>;
}

const cache = new Map<string, ProvinceData>();

export async function loadProvinceData(
  provinceCode: string
): Promise<ProvinceData> {
  const cached = cache.get(provinceCode);
  if (cached) {
    return cached;
  }

  const chunks: Record<string, () => Promise<{ default: ProvinceData }>> = {
    "11": () => import("./11"),
    "12": () => import("./12"),
    "13": () => import("./13"),
    "14": () => import("./14"),
    "15": () => import("./15"),
    "16": () => import("./16"),
    "17": () => import("./17"),
    "18": () => import("./18"),
    "19": () => import("./19"),
    "21": () => import("./21"),
    "31": () => import("./31"),
    "32": () => import("./32"),
    "33": () => import("./33"),
    "34": () => import("./34"),
    "35": () => import("./35"),
    "36": () => import("./36"),
    "51": () => import("./51"),
    "52": () => import("./52"),
    "53": () => import("./53"),
    "61": () => import("./61"),
    "62": () => import("./62"),
    "63": () => import("./63"),
    "64": () => import("./64"),
    "65": () => import("./65"),
    "71": () => import("./71"),
    "72": () => import("./72"),
    "73": () => import("./73"),
    "74": () => import("./74"),
    "75": () => import("./75"),
    "76": () => import("./76"),
    "81": () => import("./81"),
    "82": () => import("./82"),
    "91": () => import("./91"),
    "92": () => import("./92"),
    "93": () => import("./93"),
    "94": () => import("./94"),
    "95": () => import("./95"),
    "96": () => import("./96"),
  };

  const loader = chunks[provinceCode];
  if (!loader) {
    return { kabupaten: [], kecamatan: [], kelurahan: [] };
  }

  const mod = await loader();
  cache.set(provinceCode, mod.default);
  return mod.default;
}
