// bun test runs the print module (@rulisme/ui/print/pdf-fonts) the way Vite
// serves it to the apps: `import src from "./font.woff?url"` resolves to the
// font file, here as its absolute path, which react-pdf reads from disk. Bun
// resolves a `?url` import into its "url-asset" namespace and leaves loading
// it to a plugin.
import { plugin } from "bun";

const FONT_FILE = /\.woff$/;

plugin({
  name: "print-font-urls",
  setup(build) {
    build.onLoad({ filter: FONT_FILE, namespace: "url-asset" }, (args) => ({
      contents: `export default ${JSON.stringify(args.path)};`,
      loader: "js",
    }));
  },
});
