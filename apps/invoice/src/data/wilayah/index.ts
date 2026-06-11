export interface WilayahEntry {
  kode: string
  nama: string
}

export interface ProvinceData {
  kabupaten: Array<WilayahEntry>
  kecamatan: Array<WilayahEntry>
  kelurahan: Array<WilayahEntry>
}

const cache = new Map<string, ProvinceData>()

export async function loadProvinceData(
  provinceCode: string
): Promise<ProvinceData> {
  const cached = cache.get(provinceCode)
  if (cached) {
    return cached
  }

  const chunks: Record<string, () => Promise<{ default: ProvinceData }>> = {
    "11": () => import("./11.json"),
    "12": () => import("./12.json"),
    "13": () => import("./13.json"),
    "14": () => import("./14.json"),
    "15": () => import("./15.json"),
    "16": () => import("./16.json"),
    "17": () => import("./17.json"),
    "18": () => import("./18.json"),
    "19": () => import("./19.json"),
    "21": () => import("./21.json"),
    "31": () => import("./31.json"),
    "32": () => import("./32.json"),
    "33": () => import("./33.json"),
    "34": () => import("./34.json"),
    "35": () => import("./35.json"),
    "36": () => import("./36.json"),
    "51": () => import("./51.json"),
    "52": () => import("./52.json"),
    "53": () => import("./53.json"),
    "61": () => import("./61.json"),
    "62": () => import("./62.json"),
    "63": () => import("./63.json"),
    "64": () => import("./64.json"),
    "65": () => import("./65.json"),
    "71": () => import("./71.json"),
    "72": () => import("./72.json"),
    "73": () => import("./73.json"),
    "74": () => import("./74.json"),
    "75": () => import("./75.json"),
    "76": () => import("./76.json"),
    "81": () => import("./81.json"),
    "82": () => import("./82.json"),
    "91": () => import("./91.json"),
    "92": () => import("./92.json"),
    "93": () => import("./93.json"),
    "94": () => import("./94.json"),
    "95": () => import("./95.json"),
    "96": () => import("./96.json"),
  }

  const loader = chunks[provinceCode]
  if (!loader) {
    return { kabupaten: [], kecamatan: [], kelurahan: [] }
  }

  const mod = await loader()
  cache.set(provinceCode, mod.default)
  return mod.default
}
