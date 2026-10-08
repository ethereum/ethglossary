/**
 * The landing page's globe, in the "What is ETHGlossary" section: Earth
 * turning slowly west, with glossary terms flying between the cities that
 * speak them.
 *
 * A WebGL2 canvas paints the sphere, transparent around it so the
 * atmosphere lies over whatever the page is; a 2D canvas on top draws the
 * arcs and the words. Three maps, all public domain:
 * - Natural Earth "Gray Earth" shaded relief and bathymetry
 *   (public/img/earth-relief.webp, no credit required) for land and sea;
 * - NASA Black Marble 2016 night lights (public/img/earth-night-2016.webp,
 *   not under US copyright; gamma 1.5 baked in so dim lights survive
 *   compression);
 * - Natural Earth I shaded relief and water (public/img/earth-day.webp), the
 *   light-theme Earth, fetched only once light mode is in effect, and
 *   crossfaded to and from as the theme changes.
 *
 * The sphere is an eighth larger than its slot (the host's parent); the host
 * overhangs the slot so the atmosphere has room.
 */

import { GOLD, VIOLET, FONT, still, surfaces, program, loadImage, animate, needFont, claim, streak, approach } from "./gl.js"

const FRAG =
  "#version 300 es\nprecision highp float;out vec4 o;" +
  "const vec3 VIOLET=vec3(.667,.498,1.),TEAL=vec3(.055,.667,.627),BLUE=vec3(.31,.498,.878)," +
  "ROSE=vec3(1.,.549,.549),GOLD=vec3(.969,.898,.267),WARM=vec3(1.,.72,.38);" +
  "uniform vec2 uRes,uRot;uniform vec3 uGlobe;uniform sampler2D uTex,uRelief,uDay;uniform float uDayMix;" +
  "void main(){vec2 fc=gl_FragCoord.xy;vec2 d=(fc-uGlobe.xy)/uGlobe.z;float r=length(d);" +
  "vec3 L=normalize(vec3(.8,.3,-.5));vec2 dn=d/max(r,1e-4);" +
  "float sun=clamp(dot(dn,normalize(L.xy))*.5+.5,0.,1.);" +
  "vec3 atm=mix(VIOLET,TEAL,sun*.7);atm=mix(atm,ROSE,pow(sun,5.)*.7);atm=mix(atm,vec3(.45,.68,1.),uDayMix);" +
  // Outside: the atmosphere, premultiplied, cut to zero just inside the
  // canvas edge so the box never shows.
  "if(r>=1.){float a=exp(-(r-1.)*14.)*.55+exp(-(r-1.)*3.)*.12;" +
  "a*=1.-smoothstep(1.06,.97*min(uRes.x,uRes.y)*.5/uGlobe.z,r);o=vec4(atm*a,clamp(a,0.,1.));return;}" +
  "float z=sqrt(1.-r*r);vec3 nv=vec3(d,z);" +
  "float ct=cos(uRot.y),st=sin(uRot.y);vec3 w1=vec3(nv.x,nv.y*ct+nv.z*st,-nv.y*st+nv.z*ct);" +
  "float cy=cos(uRot.x),sy=sin(uRot.x);vec3 w=vec3(w1.x*cy-w1.z*sy,w1.y,w1.x*sy+w1.z*cy);" +
  "vec2 uv=vec2(atan(w.x,w.z)/6.2831853+.5,.5-asin(clamp(w.y,-1.,1.))/3.1415927);" +
  // Explicit gradients, unwrapped across the date line, so the seam does
  // not drop to the smallest mip.
  "vec2 dx=dFdx(uv),dy=dFdy(uv);if(abs(dx.x)>.5)dx.x-=sign(dx.x);if(abs(dy.x)>.5)dy.x-=sign(dy.x);" +
  "float lum=pow(textureGrad(uTex,uv,dx,dy).r,1.5);" +
  "float glow=smoothstep(.01,.4,lum);float core=smoothstep(.2,.9,lum);" +
  // Relief: sea floor ~.1-.2, land ~.4-.65 once auto-levelled.
  "float rel=textureGrad(uRelief,uv,dx,dy).r;float land=smoothstep(.27,.38,rel);" +
  "vec3 sea=vec3(.025,.03,.09)+BLUE*rel*.16;" +
  "vec3 ground=mix(vec3(.09,.07,.2),VIOLET*.5,clamp((rel-.38)*2.4,0.,1.));" +
  "vec3 surf=mix(sea,ground,land);" +
  // The coastline: a soft band either side of the land threshold, read from
  // the filtered relief so it stays smooth (fwidth() steps in 2x2 blocks).
  "surf+=TEAL*(1.-smoothstep(0.,.05,abs(rel-.32)))*.12;" +
  // A faint graticule every 15 degrees gives the dark sphere its form.
  "vec2 g=abs(fract(vec2(uv.x*24.,uv.y*12.))-.5)/max(fwidth(vec2(uv.x*24.,uv.y*12.)),1e-4);" +
  "surf+=VIOLET*(1.-min(min(g.x,g.y),1.))*.04;" +
  "surf+=WARM*glow*1.2+GOLD*core*1.4;" +
  "surf*=mix(.35,1.,pow(z,.6));" +
  "surf+=atm*pow(1.-z,3.)*.45;" +
  "float day=max(dot(nv,L),0.);surf+=(ROSE*.45+TEAL*land*.25)*pow(day,1.6)+GOLD*pow(day,6.)*.3;" +
  // Day: the colour map lit from the upper left, with a pale blue limb.
  "if(uDayMix>0.){vec3 dc=textureGrad(uDay,uv,dx,dy).rgb;float lam=max(dot(nv,normalize(vec3(-.35,.45,.82))),0.);" +
  "surf=mix(surf,dc*(.42+.7*lam)+vec3(.55,.75,1.)*pow(1.-z,2.5)*.55,uDayMix);}" +
  // The antialiased rim blends coverage too, into the glow's alpha at the
  // limb (.67), or it is an opaque stepped ring on a light page.
  "float aa=smoothstep(1.,1.-1.5/uGlobe.z,r);o=vec4(mix(atm*.67,surf,aa),mix(.67,1.,aa));}"

const RAD = Math.PI / 180
const TILT = 0.38
const SPIN = (Math.PI * 2) / 150
const FLIGHT = 2.2
const HOLD = 3
const MAX_ARCS = 8

const scheme = matchMedia("(prefers-color-scheme: light)")

/** The resolved theme, read the way the layout's toggle reads it. */
const lightTheme = () =>
  (document.documentElement.getAttribute("data-theme") || (scheme.matches ? "light" : "dark")) === "light"

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const pick = (list) => list[(Math.random() * list.length) | 0]

export function mountGlobe(host, data) {
  const day = lightTheme()
  const urls = [host.dataset.lights, host.dataset.relief].concat(day ? [host.dataset.day] : [])
  Promise.all(urls.map(loadImage)).then((imgs) => start(host, data, imgs), () => {})
}

function start(host, data, imgs) {
  let anim = null
  const s = surfaces(host, true, () => anim?.stop())
  if (!s) return
  const { gl, ctx } = s
  const prog = program(gl, FRAG, ["uRes", "uRot", "uGlobe", "uTex", "uRelief", "uDay", "uDayMix"])
  if (!prog) return host.remove()

  const texture = (img, rgb) => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    if (rgb) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, img)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  const lights = texture(imgs[0])
  const relief = texture(imgs[1])
  let dayTex = imgs[2] ? texture(imgs[2], true) : null
  let dayTarget = dayTex ? 1 : 0
  let dayMix = dayTarget
  let dayLoading = false

  let W = 0
  let H = 0
  let gdpr = 1
  let fdpr = 1
  const globe = { x: 0, y: 0, r: 1 }
  // The view drifts west, opening over East Asia and Australia (the centre
  // longitude is -yaw) and reaching the Pacific last.
  let yaw = -2.2
  let tilt = TILT
  let vel = 0
  let tvel = 0
  let clock = 0

  const cities = data.cities.map((c) => {
    const la = c.lat * RAD
    const lo = c.lon * RAD
    return { c, v: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)] }
  })

  function layout() {
    const b = host.getBoundingClientRect()
    W = b.width
    H = b.height
    const slot = host.parentElement.getBoundingClientRect().width
    globe.r = Math.min((slot / 2) * 1.125, (Math.min(W, H) / 2) * 0.86)
    globe.x = W / 2
    globe.y = H / 2
    gdpr = Math.min(devicePixelRatio || 1, 1.5)
    fdpr = Math.min(devicePixelRatio || 1, 2)
    gl.canvas.width = Math.round(W * gdpr)
    gl.canvas.height = Math.round(H * gdpr)
    ctx.canvas.width = Math.round(W * fdpr)
    ctx.canvas.height = Math.round(H * fdpr)
  }

  // ------------------------------------------------------------ globe math

  /** World unit vector -> view space (x right, y up, z toward the viewer). */
  function view(v) {
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const x = v[0] * cy + v[2] * sy
    const z = -v[0] * sy + v[2] * cy
    return [x, v[1] * ct - z * st, v[1] * st + z * ct]
  }

  const screen = (p) => [globe.x + p[0] * globe.r, globe.y - p[1] * globe.r]

  /** Behind the globe and inside its rim. */
  const hidden = (p) => p[2] <= 0 && p[0] * p[0] + p[1] * p[1] <= 1

  function slerp(a, b, t, om) {
    const s = Math.sin(om)
    const ka = Math.sin((1 - t) * om) / s
    const kb = Math.sin(t * om) / s
    return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]
  }

  // ------------------------------------------------------------ relay

  let arcs = []
  let labels = []
  let placed = []
  let term = 0
  let termAt = 0
  let spawnAt = 0

  const word = (city) => city.c.words[data.terms[term]]

  const facing = (min) => cities.filter((c) => view(c.v)[2] > min && word(c))

  /** Within a label's width of a city already showing, or about to show, a word. */
  function crowded(c) {
    const q = screen(view(c.v))
    const busy = labels.map((l) => l.city).concat(arcs.filter((x) => !x.landed).map((x) => x.b))
    return busy.some((city) => {
      const o = screen(view(city.v))
      return Math.abs(o[0] - q[0]) < 130 && Math.abs(o[1] - q[1]) < 34
    })
  }

  /** Fly the current term from `a` (or any city facing us) to one not already showing a word. */
  function spawn(a) {
    const pool = facing(0.2)
    if (pool.length < 2) return
    a = a || pick(pool)
    const to = pool.filter((c) => {
      const d = dot(c.v, a.v)
      return c !== a && d < 0.97 && d > -0.3 && !crowded(c)
    })
    if (!to.length) return
    const b = pick(to)
    const om = Math.acos(dot(a.v, b.v))
    const w = word(b)
    needFont(w)
    arcs.push({ a, b, om, lift: 0.08 + (0.3 * om) / Math.PI, t0: clock, word: w })
  }

  function drawArc(arc) {
    const t = (clock - arc.t0) / FLIGHT
    if (t >= 1 && !arc.landed) {
      arc.landed = true
      labels.push({ city: arc.b, word: arc.word, t0: clock })
      // A relay: most arrivals pass the word on.
      if (Math.random() < 0.65 && arcs.length < MAX_ARCS) spawn(arc.b)
    }
    // The tail trails the head by a third of the flight, then reels in.
    const head = Math.min(t, 1)
    const tail = Math.max(0, Math.min(1, t - 0.35))
    if (tail >= 1) return false
    const pts = []
    for (let i = 0; i <= 32; i++) {
      const s = tail + (head - tail) * (i / 32)
      const p = slerp(arc.a.v, arc.b.v, s, arc.om)
      const k = 1 + arc.lift * Math.sin(Math.PI * s)
      const q = view([p[0] * k, p[1] * k, p[2] * k])
      pts.push([...screen(q), hidden(q)])
    }
    streak(ctx, pts, t < 1)
    return true
  }

  function drawLabel(l) {
    const age = clock - l.t0
    if (age > HOLD + 0.8) return false
    const p = view(l.city.v)
    if (p[2] < 0.05) return true
    const [qx, qy] = screen(p)
    const a = Math.min(1, age / 0.3) * Math.min(1, (HOLD + 0.8 - age) / 0.8) * Math.min(1, p[2] * 4)
    // A ring that opens once on arrival.
    if (age < 1) {
      ctx.strokeStyle = `rgba(${GOLD},${(1 - age) * 0.8})`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(qx, qy, 3 + age * 14, 0, 7)
      ctx.stroke()
    }
    const rtl = l.city.c.dir === "rtl"
    ctx.font = FONT
    ctx.direction = rtl ? "rtl" : "ltr"
    ctx.textBaseline = "middle"
    const w = ctx.measureText(l.word).width
    let x = qx + 12
    const y = qy - 14
    if (x + w + 10 > W) x = qx - 28 - w
    // Rotation can still slide two labels together: the older one keeps its place.
    if (!claim(placed, [x - 8, y - 13, x + w + 8, y + 13])) return true
    ctx.fillStyle = `rgba(17,2,37,${0.72 * a})`
    ctx.strokeStyle = `rgba(${VIOLET},${0.5 * a})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x - 8, y - 13, w + 16, 26, 13)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = `rgba(255,255,255,${a})`
    ctx.textAlign = rtl ? "right" : "left"
    ctx.fillText(l.word, rtl ? x + w : x, y + 1)
    return true
  }

  function drawCities() {
    for (const city of cities) {
      const p = view(city.v)
      if (p[2] <= 0.02) continue
      const [x, y] = screen(p)
      ctx.fillStyle = `rgba(${GOLD},${Math.min(1, p[2] * 3) * 0.9})`
      ctx.beginPath()
      ctx.arc(x, y, 1.8, 0, 7)
      ctx.fill()
    }
  }

  // ------------------------------------------------------------ frame

  function draw() {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.useProgram(prog.p)
    gl.uniform2f(prog.u.uRes, gl.canvas.width, gl.canvas.height)
    gl.uniform2f(prog.u.uRot, yaw, tilt)
    gl.uniform3f(prog.u.uGlobe, globe.x * gdpr, gl.canvas.height - globe.y * gdpr, globe.r * gdpr)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, lights)
    gl.uniform1i(prog.u.uTex, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, relief)
    gl.uniform1i(prog.u.uRelief, 1)
    // Until the day map exists, bind the night one in its place: uDayMix is 0 then.
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, dayTex || lights)
    gl.uniform1i(prog.u.uDay, 2)
    gl.uniform1f(prog.u.uDayMix, dayTex ? dayMix : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    ctx.setTransform(fdpr, 0, 0, fdpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.lineCap = "round"
    drawCities()
    arcs = arcs.filter(drawArc)
    placed = []
    labels = labels.filter(drawLabel)
  }

  const clampTilt = (t) => Math.max(-1.3, Math.min(1.3, t))
  let drag = null

  function step(dt) {
    clock += dt
    if (dayTex) dayMix = approach(dayMix, dayTarget, dt / 0.6)
    if (!drag) {
      yaw += (SPIN + vel) * dt
      vel *= Math.pow(0.05, dt)
      // Tilt coasts, then settles back to the resting angle.
      tilt = clampTilt(tilt + tvel * dt)
      tvel *= Math.pow(0.05, dt)
      tilt += (TILT - tilt) * (1 - Math.pow(0.5, dt))
    }
    if (clock - termAt > 9) {
      term = (term + 1) % data.terms.length
      termAt = clock
    }
    if (clock > spawnAt && arcs.length < MAX_ARCS) {
      spawn()
      spawnAt = clock + 0.35 + Math.random() * 0.5
    }
    draw()
  }

  // ------------------------------------------------------------ theme

  /** Paused or still, there is no frame to fade over, so jump and redraw. */
  function refresh() {
    if (anim?.running()) return
    if (dayTex) dayMix = dayTarget
    draw()
  }

  function syncTheme() {
    dayTarget = lightTheme() ? 1 : 0
    if (dayTarget && !dayTex && !dayLoading) {
      dayLoading = true
      loadImage(host.dataset.day).then((img) => {
        dayTex = texture(img, true)
        refresh()
      }, () => {})
    }
    refresh()
  }

  // ------------------------------------------------------------ drag (mouse only: touch scrolls the page)

  function onGlobe(e) {
    const b = host.getBoundingClientRect()
    const dx = e.clientX - b.left - globe.x
    const dy = e.clientY - b.top - globe.y
    return dx * dx + dy * dy < globe.r * globe.r * 1.1
  }
  host.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0 || !onGlobe(e)) return
    drag = { x: e.clientX, y: e.clientY, t: performance.now() }
    host.setPointerCapture(e.pointerId)
    host.style.cursor = "grabbing"
  })
  host.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return
    if (!drag) {
      host.style.cursor = onGlobe(e) ? "grab" : ""
      return
    }
    const now = performance.now()
    const dx = (e.clientX - drag.x) / globe.r
    const dy = (e.clientY - drag.y) / globe.r
    const span = Math.max(0.016, (now - drag.t) / 1000)
    yaw += dx
    tilt = clampTilt(tilt + dy)
    vel = dx / span - SPIN
    tvel = dy / span
    drag = { x: e.clientX, y: e.clientY, t: now }
    if (!anim?.running()) draw()
  })
  const release = () => {
    drag = null
    host.style.cursor = ""
  }
  host.addEventListener("pointerup", release)
  host.addEventListener("pointercancel", release)

  // ------------------------------------------------------------ start

  layout()
  if (still) {
    // One composed frame: a term already landed in the languages facing us.
    for (const c of facing(0.35).slice(0, 4)) {
      needFont(word(c))
      labels.push({ city: c, word: word(c), t0: -1 })
    }
    clock = 0.5
    document.fonts?.ready.then(draw)
  }
  draw()
  host.style.opacity = "1"
  new ResizeObserver(() => {
    layout()
    draw()
  }).observe(host)
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
  scheme.addEventListener("change", syncTheme)
  anim = animate(host, step)
}
