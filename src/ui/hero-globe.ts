/**
 * The landing hero: a night-side Earth in a nebula, with glossary terms
 * flying between the cities that speak them.
 *
 * Two canvases. A WebGL2 one paints the sky and the globe: the sky (nebula,
 * stars) is rendered once per resize into a texture, so a frame is one
 * texture read plus the globe. The globe has two maps: Natural Earth's
 * "Gray Earth" shaded relief and bathymetry (public/img/earth-relief.webp,
 * public domain, no credit required) for land and sea, and NASA's Black
 * Marble 2016 night lights (public/img/earth-night-2016.webp, not under US
 * copyright; gamma 1.5 baked in so the dim lights survive compression). A 2D
 * canvas on top draws the arcs and the words, because text in a shader is a
 * font atlas we do not need.
 *
 * It mounts on every [data-globe] element: "hero" is the full-bleed header
 * above, "inset" is a transparent globe an eighth larger than the slot its
 * box overhangs, with no sky behind it. The inset sits on the page, so it
 * follows the theme: in light mode it crossfades to a daytime Earth (Natural
 * Earth I shaded relief and water, public/img/earth-day.webp, public domain),
 * loaded only the first time light mode is in effect.
 *
 * It costs nothing until the page has loaded, and it stays still for
 * prefers-reduced-motion and Save-Data, off-screen, and in a hidden tab. Without
 * WebGL2 the header's own gradient is the hero. Every word comes from
 * #hero-globe-data, which the server builds from the glossary
 * (src/lib/hero-relay.ts).
 */

export const HERO_GLOBE_ISLAND = `
(function () {
  var src = document.getElementById("hero-globe-data");
  if (!src) return;
  var data;
  try { data = JSON.parse(src.textContent); } catch (e) { return; }
  document.querySelectorAll("[data-globe]").forEach(function (host) {
    mount(host, host.dataset.globe === "inset");
  });

  function mount(host, inset) {
    var still = matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !!(navigator.connection && navigator.connection.saveData);

    var gl, fx, ctx;
    var W = 0, H = 0, gdpr = 1, fdpr = 1;
    var globe = { x: 0, y: 0, r: 1 };
    // The view drifts west, so it opens over East Asia and Australia (the
    // centre longitude is -yaw) and reaches the Pacific last.
    var TILT = 0.38, yaw = -2.2, tilt = TILT, spin = (Math.PI * 2) / 150, vel = 0, tvel = 0;
    var bgTex, bgFbo, lights, relief, progBg, progMain;
    var running = false, visible = true, last = 0, clock = 0;

    var VIOLET = "170,127,255", TEAL = "14,170,160", GOLD = "247,229,68";

    // ---------------------------------------------------------------- shaders

    var VERT = "#version 300 es\\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

    var COMMON = "#version 300 es\\nprecision highp float;out vec4 o;" +
      "const vec3 VIOLET=vec3(.667,.498,1.),TEAL=vec3(.055,.667,.627),BLUE=vec3(.31,.498,.878)," +
      "ROSE=vec3(1.,.549,.549),GOLD=vec3(.969,.898,.267),WARM=vec3(1.,.72,.38);" +
      "uniform vec2 uRes;uniform vec3 uGlobe;";

    var BG = COMMON + "uniform float uDpr;" +
      "float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}" +
      "float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);" +
      "return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}" +
      "float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return s;}" +
      "vec3 stars(vec2 fc,float cell,float th,float size){vec2 p=fc/(cell*uDpr),id=floor(p);" +
      "if(h(id+7.7)<th)return vec3(0);vec2 c=vec2(.2)+.6*vec2(h(id),h(id+3.1));" +
      "float d=length(fract(p)-c)*cell;float b=h(id+1.7);" +
      "return vec3(.85,.88,1.)*b*b*smoothstep(size,0.,d);}" +
      "void main(){vec2 fc=gl_FragCoord.xy;float sx=fc.x/uRes.x;vec2 uv=fc/uRes.y;" +
      "vec3 col=mix(vec3(.055,.01,.12),vec3(.07,.08,.13),sx);" +
      "float dg=length((fc-uGlobe.xy)/uGlobe.z);float near=exp(-max(dg-1.,0.)*1.1);" +
      "vec2 q=uv*2.1;float f=fbm(q+fbm(q*1.3+3.)*1.5);float f2=fbm(q*1.6+vec2(5.2,1.3));" +
      "float m=smoothstep(.1,1.,sx)*.55+near*.7;" +
      "col+=VIOLET*pow(f,3.)*.5*m+TEAL*pow(f2,4.)*.3*m+BLUE*pow(f*f2,2.)*.22*m;" +
      "col+=stars(fc,19.,.93,1.1)*.8+stars(fc,57.,.9,1.7);" +
      "o=vec4(col,1.);}";

    var MAIN = COMMON + "uniform sampler2D uBg,uTex,uRelief,uDay;uniform vec2 uRot;uniform float uInset,uDayMix;" +
      "void main(){vec2 fc=gl_FragCoord.xy;vec3 col=uInset>.5?vec3(0):texture(uBg,fc/uRes).rgb;" +
      "vec2 d=(fc-uGlobe.xy)/uGlobe.z;float r=length(d);" +
      "vec3 L=normalize(vec3(.8,.3,-.5));vec2 dn=d/max(r,1e-4);" +
      "float sun=clamp(dot(dn,normalize(L.xy))*.5+.5,0.,1.);" +
      "vec3 atm=mix(VIOLET,TEAL,sun*.7);atm=mix(atm,ROSE,pow(sun,5.)*.7);atm=mix(atm,vec3(.45,.68,1.),uDayMix);" +
      "if(r>=1.){float a=exp(-(r-1.)*14.)*.55+exp(-(r-1.)*3.)*.12;col+=atm*a;" +
      // Inset: premultiplied, so the glow lies over whatever the page is.
      // The glow is cut to zero just inside the canvas edge so the box never shows.
      "if(uInset>.5){a*=1.-smoothstep(1.06,.97*min(uRes.x,uRes.y)*.5/uGlobe.z,r);o=vec4(atm*a,clamp(a,0.,1.));return;}" +
      "o=vec4(col,1.);return;}" +
      "float z=sqrt(1.-r*r);vec3 nv=vec3(d,z);" +
      "float ct=cos(uRot.y),st=sin(uRot.y);vec3 w1=vec3(nv.x,nv.y*ct+nv.z*st,-nv.y*st+nv.z*ct);" +
      "float cy=cos(uRot.x),sy=sin(uRot.x);vec3 w=vec3(w1.x*cy-w1.z*sy,w1.y,w1.x*sy+w1.z*cy);" +
      "vec2 uv=vec2(atan(w.x,w.z)/6.2831853+.5,.5-asin(clamp(w.y,-1.,1.))/3.1415927);" +
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
      "float aa=smoothstep(1.,1.-1.5/uGlobe.z,r);" +
      // Inset: the antialiased rim blends coverage too, into the glow's own
      // alpha at the limb (.67), or it is an opaque stepped ring on a light page.
      "if(uInset>.5){o=vec4(mix(atm*.67,surf,aa),mix(.67,1.,aa));return;}" +
      "col=mix(col+atm*.55,surf,aa);o=vec4(col,1.);}";

    // ---------------------------------------------------------------- setup

    function shader(type, source) {
      var s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }

    function program(fsrc, names) {
      var v = shader(gl.VERTEX_SHADER, VERT), f = shader(gl.FRAGMENT_SHADER, fsrc);
      if (!v || !f) return null;
      var p = gl.createProgram();
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, "p");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
      var u = {};
      names.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
      return { p: p, u: u };
    }

    function canvas() {
      var c = document.createElement("canvas");
      c.className = "absolute inset-0 size-full";
      host.appendChild(c);
      return c;
    }

    function texture(img, rgb) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (rgb) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, img);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    function init(imgs) {
      var glc = canvas();
      gl = glc.getContext("webgl2", { antialias: false, alpha: inset, powerPreference: "low-power" });
      if (!gl) { glc.remove(); return false; }
      progBg = program(BG, ["uRes", "uGlobe", "uDpr"]);
      progMain = program(MAIN, ["uRes", "uGlobe", "uRot", "uBg", "uTex", "uRelief", "uInset", "uDay", "uDayMix"]);
      if (!progBg || !progMain) { glc.remove(); return false; }

      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      lights = texture(imgs[0]);
      relief = texture(imgs[1]);

      bgTex = gl.createTexture();
      bgFbo = gl.createFramebuffer();

      glc.addEventListener("webglcontextlost", function () { running = false; host.remove(); });

      fx = canvas();
      ctx = fx.getContext("2d");
      return true;
    }

    // ---------------------------------------------------------------- layout

    function layout() {
      var b = host.getBoundingClientRect();
      W = b.width; H = b.height;
      if (inset) {
        // An eighth larger than the slot it sits in, while leaving the
        // canvas's overhang enough room for the atmosphere.
        var slot = host.parentElement.getBoundingClientRect().width;
        globe.r = Math.min((slot / 2) * 1.125, (Math.min(W, H) / 2) * 0.86);
        globe.x = W / 2;
        globe.y = H / 2;
      } else if (W >= 768) {
        // Just past the top, bottom and right edges (a few percent of the
        // diameter each), shrunk where needed so no more than a sliver of the
        // limb slides under the copy.
        var copy = copyRight(b);
        globe.r = Math.max(H * 0.25, Math.min(H * 0.52, (W - copy) / 1.77));
        globe.x = W - globe.r * 0.92;
        globe.y = H * 0.5;
      } else {
        globe.r = W * 0.55;
        globe.x = W * 0.9;
        globe.y = H - globe.r * 0.6;
      }
      gdpr = Math.min(devicePixelRatio || 1, 1.5);
      fdpr = Math.min(devicePixelRatio || 1, 2);
      var gw = Math.round(W * gdpr), gh = Math.round(H * gdpr);
      gl.canvas.width = gw; gl.canvas.height = gh;
      fx.width = Math.round(W * fdpr); fx.height = Math.round(H * fdpr);

      if (inset) return;
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bgFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bgTex, 0);
      gl.viewport(0, 0, gw, gh);
      gl.useProgram(progBg.p);
      setGlobe(progBg.u, gw, gh);
      gl.uniform1f(progBg.u.uDpr, gdpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Right edge of the hero's heading and lede. Measured on the text nodes, not
     * the elements: those are full-width blocks, and so is the h1's inner span.
     */
    function copyRight(b) {
      var r = document.createRange(), right = 0;
      host.parentElement.querySelectorAll("h1, p").forEach(function (el) {
        var walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node;
        while ((node = walk.nextNode())) {
          r.selectNodeContents(node);
          right = Math.max(right, r.getBoundingClientRect().right);
        }
      });
      return right - b.left;
    }

    function setGlobe(u, gw, gh) {
      gl.uniform2f(u.uRes, gw, gh);
      gl.uniform3f(u.uGlobe, globe.x * gdpr, gh - globe.y * gdpr, globe.r * gdpr);
    }

    // ---------------------------------------------------------------- globe math

    var RAD = Math.PI / 180;
    var cities = data.cities.map(function (c) {
      var la = c.lat * RAD, lo = c.lon * RAD;
      return { c: c, v: [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)] };
    });

    /** World unit vector -> view space (x right, y up, z toward the viewer). */
    function view(v) {
      var cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
      var x = v[0] * cy + v[2] * sy, z = -v[0] * sy + v[2] * cy, y = v[1];
      return [x, y * ct - z * st, y * st + z * ct];
    }

    function screen(p) { return [globe.x + p[0] * globe.r, globe.y - p[1] * globe.r]; }

    /** In front of the globe, or out past its rim. */
    function shown(p) { return p[2] > 0 || p[0] * p[0] + p[1] * p[1] > 1; }

    function slerp(a, b, t, om) {
      var s = Math.sin(om), ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
      return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
    }

    // ---------------------------------------------------------------- relay

    var arcs = [], labels = [], placed = [], term = 0, termAt = 0, spawnAt = 0;
    var FLIGHT = 2.2, HOLD = 3, MAX_ARCS = 8;

    function facing(min) {
      return cities.filter(function (c) { return view(c.v)[2] > min && c.c.words[data.terms[term]]; });
    }

    function pick(list) { return list[(Math.random() * list.length) | 0]; }

    /** Fly the current term from a (or any city facing us) to a city that is not already showing it. */
    function spawn(a) {
      var pool = facing(0.2);
      if (pool.length < 2) return;
      a = a || pick(pool);
      var to = pool.filter(function (c) {
        var d = c.v[0] * a.v[0] + c.v[1] * a.v[1] + c.v[2] * a.v[2];
        return c !== a && d < 0.97 && d > -0.3 && !crowded(c);
      });
      if (!to.length) return;
      var b = pick(to);
      var om = Math.acos(a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2]);
      arcs.push({ a: a, b: b, om: om, lift: 0.08 + 0.3 * om / Math.PI, t0: clock, word: b.c.words[data.terms[term]] });
    }

    /** Within a label's width of a city already showing, or about to show, a word. */
    function crowded(c) {
      var q = screen(view(c.v));
      return labels.concat(arcs.filter(function (x) { return !x.landed; }).map(function (x) { return { city: x.b }; }))
        .some(function (l) {
          var o = screen(view(l.city.v)), dx = o[0] - q[0], dy = o[1] - q[1];
          return Math.abs(dx) < 130 && Math.abs(dy) < 34;
        });
    }

    function arcPoint(arc, s) {
      var p = slerp(arc.a.v, arc.b.v, s, arc.om), k = 1 + arc.lift * Math.sin(Math.PI * s);
      return view([p[0] * k, p[1] * k, p[2] * k]);
    }

    function drawArc(arc, now) {
      var t = (now - arc.t0) / FLIGHT;
      if (t >= 1 && !arc.landed) {
        arc.landed = true;
        labels.push({ city: arc.b, word: arc.word, t0: now });
        // A relay: most arrivals pass the word on.
        if (Math.random() < 0.65 && arcs.length < MAX_ARCS) spawn(arc.b);
      }
      // The tail trails the head by a third of the flight, then reels in.
      var head = Math.min(t, 1), tail = Math.max(0, Math.min(1, t - 0.35));
      if (tail >= 1) return false;
      var steps = 32, pts = [];
      for (var i = 0; i <= steps; i++) {
        var p = arcPoint(arc, tail + (head - tail) * (i / steps));
        pts.push({ q: screen(p), on: shown(p) });
      }
      // Two passes: a wide soft glow, then the bright line, both brightening toward the head.
      for (var pass = 0; pass < 2; pass++) {
        for (var j = 1; j <= steps; j++) {
          if (!pts[j].on || !pts[j - 1].on) continue;
          var k = j / steps;
          ctx.strokeStyle = pass
            ? "rgba(" + (k > 0.75 ? GOLD : TEAL) + "," + (0.2 + 0.8 * k) + ")"
            : "rgba(" + VIOLET + "," + 0.18 * k + ")";
          ctx.lineWidth = pass ? 0.8 + 1.6 * k : 4 + 6 * k;
          ctx.beginPath(); ctx.moveTo(pts[j - 1].q[0], pts[j - 1].q[1]); ctx.lineTo(pts[j].q[0], pts[j].q[1]); ctx.stroke();
        }
      }
      var tip = pts[steps];
      if (t < 1 && tip.on) {
        var g = ctx.createRadialGradient(tip.q[0], tip.q[1], 0, tip.q[0], tip.q[1], 9);
        g.addColorStop(0, "rgba(255,255,240,0.95)");
        g.addColorStop(0.3, "rgba(" + GOLD + ",0.6)");
        g.addColorStop(1, "rgba(" + GOLD + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(tip.q[0], tip.q[1], 9, 0, 7); ctx.fill();
      }
      return true;
    }

    function drawLabel(l, now) {
      var age = now - l.t0;
      if (age > HOLD + 0.8) return false;
      var p = view(l.city.v);
      if (p[2] < 0.05) return true;
      var q = screen(p);
      var a = Math.min(1, age / 0.3) * Math.min(1, (HOLD + 0.8 - age) / 0.8) * Math.min(1, p[2] * 4);
      // A ring that opens once on arrival.
      if (age < 1) {
        ctx.strokeStyle = "rgba(" + GOLD + "," + (1 - age) * 0.8 + ")";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(q[0], q[1], 3 + age * 14, 0, 7); ctx.stroke();
      }
      // Below md the globe sits behind the copy: rings only, no words.
      if (!inset && W < 768) return true;
      var rtl = l.city.c.dir === "rtl";
      ctx.font = "500 15px 'Noto Sans', system-ui, sans-serif";
      ctx.direction = rtl ? "rtl" : "ltr";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      var w = ctx.measureText(l.word).width, x = q[0] + 12, y = q[1] - 14;
      if (x + w + 10 > W) x = q[0] - 12 - w - 16;
      // Rotation can still slide two labels together: the older one keeps its place.
      var box = [x - 8, y - 13, x + w + 8, y + 13];
      if (placed.some(function (o) { return box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3]; })) return true;
      placed.push(box);
      ctx.fillStyle = "rgba(17,2,37," + 0.72 * a + ")";
      ctx.strokeStyle = "rgba(" + VIOLET + "," + 0.5 * a + ")";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x - 8, y - 13, w + 16, 26, 13); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255," + a + ")";
      ctx.textAlign = rtl ? "right" : "left";
      ctx.fillText(l.word, rtl ? x + w : x, y + 1);
      return true;
    }

    function drawCities() {
      for (var i = 0; i < cities.length; i++) {
        var p = view(cities[i].v);
        if (p[2] <= 0.02) continue;
        var q = screen(p);
        ctx.fillStyle = "rgba(" + GOLD + "," + Math.min(1, p[2] * 3) * 0.9 + ")";
        ctx.beginPath(); ctx.arc(q[0], q[1], 1.8, 0, 7); ctx.fill();
      }
    }

    // ---------------------------------------------------------------- frame

    function draw() {
      var gw = gl.canvas.width, gh = gl.canvas.height;
      gl.viewport(0, 0, gw, gh);
      gl.useProgram(progMain.p);
      setGlobe(progMain.u, gw, gh);
      gl.uniform2f(progMain.u.uRot, yaw, tilt);
      gl.uniform1f(progMain.u.uInset, inset ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.uniform1i(progMain.u.uBg, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lights);
      gl.uniform1i(progMain.u.uTex, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, relief);
      gl.uniform1i(progMain.u.uRelief, 2);
      // Until the day map exists, bind the night one in its place: uDayMix is 0 then.
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, dayTex || lights);
      gl.uniform1i(progMain.u.uDay, 3);
      gl.uniform1f(progMain.u.uDayMix, dayTex ? dayMix : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      ctx.setTransform(fdpr, 0, 0, fdpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";
      drawCities();
      arcs = arcs.filter(function (a) { return drawArc(a, clock); });
      placed = [];
      labels = labels.filter(function (l) { return drawLabel(l, clock); });
    }

    function tick(now) {
      if (!running) return;
      requestAnimationFrame(tick);
      if (now - last < 32) return;
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += dt;
      if (dayTex && dayMix !== dayTarget) {
        dayMix = dayTarget > dayMix ? Math.min(dayTarget, dayMix + dt / 0.6) : Math.max(dayTarget, dayMix - dt / 0.6);
      }
      if (!drag) {
        yaw += (spin + vel) * dt;
        vel *= Math.pow(0.05, dt);
        // Tilt coasts, then settles back to the resting angle.
        tilt = clampTilt(tilt + tvel * dt);
        tvel *= Math.pow(0.05, dt);
        tilt += (TILT - tilt) * (1 - Math.pow(0.5, dt));
      }
      if (clock - termAt > 9) { term = (term + 1) % data.terms.length; termAt = clock; }
      if (clock > spawnAt && arcs.length < MAX_ARCS) { spawn(); spawnAt = clock + 0.35 + Math.random() * 0.5; }
      draw();
    }

    function play() {
      if (still || running || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(tick);
    }

    // ---------------------------------------------------------------- theme (inset only)

    var dayTex = null, dayMix = 0, dayTarget = 0, dayLoading = false;
    var schemeLight = matchMedia("(prefers-color-scheme: light)");

    /** The resolved theme, the same way the layout's toggle reads it. */
    function lightTheme() {
      return (document.documentElement.getAttribute("data-theme") || (schemeLight.matches ? "light" : "dark")) === "light";
    }

    function syncTheme() {
      if (!inset || !gl) return;
      dayTarget = lightTheme() ? 1 : 0;
      if (dayTarget && !dayTex && !dayLoading) {
        dayLoading = true;
        load(host.dataset.day).then(function (img) { dayTex = texture(img, true); refresh(); }, function () {});
      }
      refresh();
    }

    /** Paused or still, there is no tick to fade, so jump and redraw. */
    function refresh() {
      if (running) return;
      if (dayTex) dayMix = dayTarget;
      draw();
    }

    // ---------------------------------------------------------------- drag (mouse only: touch scrolls the page)

    var drag = null;
    function clampTilt(t) { return Math.max(-1.3, Math.min(1.3, t)); }
    var header = inset ? host : host.parentElement;
    function onGlobe(e) {
      var b = host.getBoundingClientRect();
      var dx = e.clientX - b.left - globe.x, dy = e.clientY - b.top - globe.y;
      return dx * dx + dy * dy < globe.r * globe.r * 1.1;
    }
    header.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch" || e.button !== 0 || e.target.closest("a,button") || !onGlobe(e)) return;
      drag = { x: e.clientX, y: e.clientY, t: performance.now() };
      header.setPointerCapture(e.pointerId);
      header.style.cursor = "grabbing";
    });
    header.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      if (!drag) { header.style.cursor = onGlobe(e) && !e.target.closest("a,button") ? "grab" : ""; return; }
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y, now = performance.now();
      var span = Math.max(0.016, (now - drag.t) / 1000);
      yaw += dx / globe.r;
      tilt = clampTilt(tilt + dy / globe.r);
      vel = dx / globe.r / span - spin;
      tvel = dy / globe.r / span;
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
      if (!running) draw();
    });
    function release() { drag = null; header.style.cursor = ""; }
    header.addEventListener("pointerup", release);
    header.addEventListener("pointercancel", release);

    // ---------------------------------------------------------------- start

    function load(url) {
      return new Promise(function (ok, fail) {
        var img = new Image();
        img.decoding = "async";
        img.onload = function () { ok(img); };
        img.onerror = fail;
        img.src = url;
      });
    }

    function start() {
      var day = inset && lightTheme();
      var urls = [host.dataset.lights, host.dataset.relief].concat(day ? [host.dataset.day] : []);
      Promise.all(urls.map(load)).then(function (imgs) {
        if (!init(imgs)) return;
        if (day) { dayTex = texture(imgs[2], true); dayMix = dayTarget = 1; }
        layout();
        if (still) {
          // One composed frame: a term already landed in the languages facing us.
          facing(0.35).slice(0, 4).forEach(function (c) {
            labels.push({ city: c, word: c.c.words[data.terms[term]], t0: -1 });
          });
          clock = 0.5;
        }
        draw();
        host.style.opacity = "1";
        new ResizeObserver(function () { layout(); draw(); }).observe(host);
        new IntersectionObserver(function (es) {
          visible = es[0].isIntersecting;
          if (visible) play(); else running = false;
        }).observe(host);
        document.addEventListener("visibilitychange", function () {
          if (document.hidden) running = false; else play();
        });
        if (inset) {
          new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
          schemeLight.addEventListener("change", syncTheme);
        }
        play();
      }, function () {});
    }

    if (document.readyState === "complete") start();
    else addEventListener("load", start, { once: true });
  }
})();
`
