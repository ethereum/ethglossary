/**
 * What the landing page's two WebGL islands share: context and program
 * setup, the animation lifecycle and its guards, and the glowing arc both of
 * them draw a word along.
 *
 * Browser code, bundled and minified into one script by the `?island`
 * loader in scripts/build-server.mjs (see src/ui/landing/island.js).
 */

/** Canvas colours, as "r,g,b" for rgba(): the palette's violet, teal and yellow. */
export const VIOLET = "170,127,255"
export const TEAL = "14,170,160"
export const GOLD = "247,229,68"

/**
 * Labels and bubbles: the page's own face, so the self-hosted subsets apply.
 * Regular weight, because the non-Latin subsets (Bengali, Tamil...) ship only
 * in 400 and 700 and font matching picks the weight before the script.
 */
export const FONT = "400 15px 'Noto Sans', system-ui, sans-serif"

/** A full-screen triangle; every pass is a fragment shader over it. */
const VERT = "#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}"

/** Reduced motion or Save-Data: draw one composed frame and never animate. */
export const still =
  matchMedia("(prefers-reduced-motion: reduce)").matches || !!navigator.connection?.saveData

export function onLoad(fn) {
  if (document.readyState === "complete") fn()
  else addEventListener("load", fn, { once: true })
}

function canvas(host) {
  const c = document.createElement("canvas")
  c.className = "absolute inset-0 size-full"
  host.appendChild(c)
  return c
}

/**
 * A WebGL2 canvas with the full-screen triangle bound, and a 2D canvas over
 * it for lines and text. Null without WebGL2, leaving the host empty. A lost
 * context removes the host, so the page falls back to what is behind it.
 */
export function surfaces(host, alpha, onLost) {
  const glc = canvas(host)
  const gl = glc.getContext("webgl2", { antialias: false, alpha, powerPreference: "low-power" })
  if (!gl) {
    glc.remove()
    return null
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  glc.addEventListener("webglcontextlost", () => {
    onLost()
    host.remove()
  })
  const ctx = canvas(host).getContext("2d")
  return { gl, ctx }
}

/** Compile and link a fragment shader; `u` maps each named uniform to its location. Null on failure. */
export function program(gl, frag, names) {
  const compile = (type, source) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, source)
    gl.compileShader(s)
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
  }
  const v = compile(gl.VERTEX_SHADER, VERT)
  const f = compile(gl.FRAGMENT_SHADER, frag)
  if (!v || !f) return null
  const p = gl.createProgram()
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.bindAttribLocation(p, 0, "p")
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null
  const u = {}
  for (const n of names) u[n] = gl.getUniformLocation(p, n)
  return { p, u }
}

export function loadImage(url) {
  return new Promise((ok, fail) => {
    const img = new Image()
    img.decoding = "async"
    img.onload = () => ok(img)
    img.onerror = fail
    img.src = url
  })
}

/**
 * Run `step(dt)` at up to 30 frames a second while the host is on screen and
 * the tab is visible; never when `still`. `running()` lets a caller redraw by
 * hand when no frame is coming; `stop()` ends it for good.
 */
export function animate(host, step) {
  let stopped = false
  let running = false
  let visible = true
  let last = 0
  const tick = (now) => {
    if (!running) return
    requestAnimationFrame(tick)
    if (now - last < 32) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    step(dt)
  }
  const play = () => {
    if (still || stopped || running || !visible || document.hidden) return
    running = true
    last = performance.now()
    requestAnimationFrame(tick)
  }
  new IntersectionObserver((es) => {
    visible = es[0].isIntersecting
    if (visible) play()
    else running = false
  }).observe(host)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) running = false
    else play()
  })
  play()
  return {
    running: () => running,
    stop: () => {
      stopped = true
      running = false
    },
  }
}

/**
 * Canvas text does not trigger @font-face loading, and the page's script
 * subsets (Bengali, Tamil, Telugu...) load only when something renders in
 * them. Ask for each word's subset once, as it is about to be drawn.
 */
const asked = new Set()
export function needFont(text) {
  if (asked.has(text)) return
  asked.add(text)
  document.fonts?.load(FONT, text)
}

/**
 * Claim a rectangle [x0, y0, x1, y1] for a label this frame. False when it
 * would overlap one already placed, so the older label keeps its place.
 */
export function claim(placed, box) {
  if (placed.some((o) => box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3])) return false
  placed.push(box)
  return true
}

/**
 * The line a word travels along: a wide soft glow, then a bright core, both
 * brightening toward the head, and a glowing tip while it is in flight.
 * `pts` are [x, y, hidden?]; a segment touching a hidden point is skipped.
 */
export function streak(ctx, pts, flying) {
  const n = pts.length - 1
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 1; j <= n; j++) {
      if (pts[j][2] || pts[j - 1][2]) continue
      const k = j / n
      ctx.strokeStyle = pass
        ? `rgba(${k > 0.75 ? GOLD : TEAL},${0.2 + 0.8 * k})`
        : `rgba(${VIOLET},${0.18 * k})`
      ctx.lineWidth = pass ? 0.8 + 1.6 * k : 4 + 6 * k
      ctx.beginPath()
      ctx.moveTo(pts[j - 1][0], pts[j - 1][1])
      ctx.lineTo(pts[j][0], pts[j][1])
      ctx.stroke()
    }
  }
  const [x, y, hidden] = pts[n]
  if (!flying || hidden) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, 9)
  g.addColorStop(0, "rgba(255,255,240,0.95)")
  g.addColorStop(0.3, `rgba(${GOLD},0.6)`)
  g.addColorStop(1, `rgba(${GOLD},0)`)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, 9, 0, 7)
  ctx.fill()
}

/** Move `from` toward `to` by at most `step`: a linear fade. */
export const approach = (from, to, step) => (to > from ? Math.min(to, from + step) : Math.max(to, from - step))
