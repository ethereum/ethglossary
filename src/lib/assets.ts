/**
 * The stylesheet's URL carries a hash of its content, so every deploy is a
 * new URL and the browser may cache the old one for as long as it likes. The
 * app knows nothing about the filesystem; the Node entry, which does, hands
 * in a reader for the current hash at startup.
 */

let readVersion: (() => string | null) | null = null

export function setCssVersion(read: () => string | null): void {
  readVersion = read
}

export function cssHref(): string {
  const v = readVersion?.()
  return v ? `/assets/app.css?v=${v}` : "/assets/app.css"
}
