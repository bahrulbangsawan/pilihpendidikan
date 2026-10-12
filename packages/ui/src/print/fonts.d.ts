// The merged print cuts in ./fonts are imported as asset URLs (Vite's `?url`),
// which react-pdf fetches when a document first renders.
declare module "*.woff?url" {
  const src: string;
  export default src;
}
