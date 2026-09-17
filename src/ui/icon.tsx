/**
 * Renders an imported .svg file inline.
 *
 * Import the glyph where you use it and pass it in:
 *
 *   import thumbsUp from "lucide-static/icons/thumbs-up.svg"
 *   <Icon svg={thumbsUp} class="size-4" />
 *
 * Lucide's files already carry `stroke="currentColor"`, so color comes from
 * the surrounding text color for free. Sizing is a Tailwind class on the
 * wrapper; the svg fills its height and keeps its own aspect ratio, so a
 * non-square mark like the wordmark is not squashed.
 *
 * The `.icon` base sits in the components layer (see app.css), so a caller's
 * `hidden` or `lg:block` beats it rather than tying with it.
 *
 * Custom artwork Lucide does not ship -- the brand marks and the decorative
 * glyphs -- lives in ./icons and imports exactly the same way.
 */

import { raw } from "hono/html"

interface IconProps {
  /** An imported .svg, resolved to its source text by esbuild's text loader. */
  svg: string
  /** Tailwind sizing and color, e.g. "size-4 text-foreground-subtle". */
  class?: string
}

export const Icon = ({ svg, class: cls }: IconProps) => (
  <span
    class={`icon ${cls ?? ""}`}
    aria-hidden="true"
  >
    {raw(svg)}
  </span>
)
