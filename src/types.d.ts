declare module "*.txt" {
  const content: string
  export default content
}

declare module "*.svg" {
  const content: string
  export default content
}

/** A browser module bundled and minified into one script by the `?island` loader (scripts/build-server.mjs). */
declare module "*?island" {
  const script: string
  export default script
}
