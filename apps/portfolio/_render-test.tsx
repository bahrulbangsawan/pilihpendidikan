import { renderToFile } from "@react-pdf/renderer"
import { PortfolioDocument } from "@/components/portfolio-pdf"
import type { Portfolio } from "@/components/portfolio-data-model"
import sample from "@/data/sample-portfolio.json"
import en from "@/i18n/locales/en.json"

type Dict = Record<string, unknown>

function makeT(dict: Dict) {
  return (key: string, params?: Record<string, string | number>) => {
    const val = key
      .split(".")
      .reduce<unknown>(
        (o, k) => (o && typeof o === "object" ? (o as Dict)[k] : undefined),
        dict
      )
    let str = typeof val === "string" ? val : key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replaceAll(`{${k}}`, String(v))
      }
    }
    return str
  }
}

const t = makeT(en as Dict)
const out = process.argv[2] ?? "/tmp/test-portfolio.pdf"
const dataPath = process.argv[3]
const data: Portfolio = dataPath
  ? (JSON.parse(await Bun.file(dataPath).text()) as Portfolio)
  : (sample as unknown as Portfolio)
await renderToFile(<PortfolioDocument data={data} t={t} />, out)
// biome-ignore lint/suspicious/noConsole: throwaway render harness
console.log("rendered", out)
