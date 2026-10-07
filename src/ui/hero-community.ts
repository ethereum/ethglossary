/**
 * The landing hero: a community hall drawn as line art -- arched windows
 * under a cornice, lamps, plants and a crowd of people -- scrolling slowly
 * sideways forever, with glossary terms passing between them: one person
 * says a word in their language, a line carries it to a neighbour, who hears
 * it in theirs.
 *
 * The hall is drawn by a fragment shader from signed distance functions:
 * tapered capsules for shoulders, limbs and skirts, circles, rounded boxes.
 * Each part is filled with a gentle fall-off toward its edge and given a
 * faint outline; people stand in soft contact shadows, lit by the lamps.
 * It is static, so it is rendered once per resize into a texture one tile
 * wide that repeats seamlessly, with alpha: the windows and everything above
 * the cornice are left transparent. Each frame then paints the moving sky
 * (twinkling stars in parallax layers, a drifting nebula, shooting stars, a
 * satellite), the site's dot grid over it, and the tile over both at a
 * scrolling offset. The lines and speech bubbles are a 2D canvas on top, so
 * the words are real text in real fonts.
 *
 * Same guards as the globe island (src/ui/hero-globe.ts): waits for load,
 * still for reduced motion and Save-Data, pauses off-screen and in a hidden
 * tab, and leaves the header's gradient in place without WebGL2. Words come
 * from #hero-globe-data (src/lib/hero-relay.ts); only the languages and
 * their words are used here, the cities belong to the globe.
 */

export const HERO_COMMUNITY_ISLAND = `
(function () {
  var host = document.getElementById("hero-scene");
  var src = document.getElementById("hero-globe-data");
  if (!host || !src) return;
  var data;
  try { data = JSON.parse(src.textContent); } catch (e) { return; }

  var still = matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !!(navigator.connection && navigator.connection.saveData);

  var gl, fx, ctx, progTile, progMain, tileTex, tileFbo;
  var W = 0, H = 0, gdpr = 1, fdpr = 1, tileW = 0, fade = 0;
  var off = 0, SPEED = 16, running = false, visible = true, last = 0, clock = 0;
  var people = [];

  var VIOLET = "170,127,255", TEAL = "14,170,160", GOLD = "247,229,68";
  var MAX_PEOPLE = 32;

  // ---------------------------------------------------------------- shaders

  var VERT = "#version 300 es\\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

  var TILE = "#version 300 es\\nprecision highp float;out vec4 o;" +
    "const vec3 INK=vec3(.9,.88,1.),VIOLET=vec3(.667,.498,1.),TEAL=vec3(.055,.667,.627)," +
    "BLUE=vec3(.31,.498,.878),ROSE=vec3(1.,.549,.549),GOLD=vec3(.969,.898,.267);" +
    "uniform vec2 uRes;uniform float uDpr,uGround,uArch;uniform vec4 uP[" + MAX_PEOPLE + "],uQ[" + MAX_PEOPLE + "];uniform int uN;" +
    // C and A accumulate premultiplied colour and coverage; whatever stays
    // uncovered (the arch windows, the sky above the cornice) is transparent,
    // and the per-frame pass paints the moving sky there.
    "vec3 C;float A,W_,AA,SH;" +
    "float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}" +
    "float cap(vec2 p,vec2 a,vec2 b,float r){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.))-r;}" +
    // A capsule whose ends differ in radius (Inigo Quilez): tapered limbs, shoulders, skirts.
    "float uc(vec2 p,vec2 a,vec2 b,float ra,float rb){p-=a;b-=a;float hh=dot(b,b);vec2 q=vec2(dot(p,vec2(b.y,-b.x)),dot(p,b))/hh;" +
    "q.x=abs(q.x);float k0=ra-rb;vec2 c=vec2(sqrt(hh-k0*k0),k0);float k=c.x*q.y-c.y*q.x,m=dot(c,q),n=dot(q,q);" +
    "if(k<0.)return sqrt(hh*n)-ra;if(k>c.x)return sqrt(hh*(n+1.-2.*q.y))-rb;return m-ra;}" +
    "float box(vec2 p,vec2 c,vec2 b,float r){vec2 d=abs(p-c)-b+r;return length(max(d,0.))+min(max(d.x,d.y),0.)-r;}" +
    "void cover(vec3 f,float m){C=mix(C,f,m);A=mix(A,1.,m);}" +
    // Fill with a little volume -- a gentle fall-off from the middle of each
    // part toward its edge -- then a faint outline.
    "void paint(float d,vec3 f){cover(f*mix(1.08,.8,smoothstep(-SH,0.,d)),smoothstep(AA,-AA,d));" +
    "cover(INK,(1.-smoothstep(W_-AA,W_+AA,abs(d)))*.22);}" +
    "vec3 shirt(float k){return k<1.?VIOLET:k<2.?TEAL:k<3.?ROSE:k<4.?BLUE:GOLD;}" +
    "vec3 skin(float k){return k<1.?vec3(.97,.83,.72):k<2.?vec3(.84,.64,.48):k<3.?vec3(.62,.43,.31):vec3(.42,.28,.21);}" +
    "vec3 cloth(float k){return k<1.?vec3(.2,.2,.38):k<2.?vec3(.3,.2,.16):k<3.?vec3(.16,.26,.26):vec3(.32,.18,.34);}" +

    // A person, height 1, feet at the origin. P.w = pose; Q = (shirt, hair, skin, cloth).
    // Poses: 0 standing, 1 waving, 2 holding a phone, 3 on a stool, 4 wheelchair, 5 talking.
    // cloth 3 is a skirt rather than trousers.
    "void person(vec2 q,vec4 P,vec4 Q){" +
    "float pose=P.w;bool sit=pose>2.5&&pose<4.5,skirt=Q.w>2.5&&!sit;float L=sit?-.1:0.;" +
    "vec3 sh=shirt(Q.x)*.72,pa=cloth(Q.w),sk=skin(Q.z),hr=vec3(.16,.1,.18),shoe=vec3(.1,.08,.14),wood=vec3(.3,.22,.36);" +
    "vec2 hd=vec2(0.,.905+L);" +
    "if(pose>3.5&&pose<4.5){paint(cap(q,vec2(-.19,.06),vec2(-.19,.42),.045),wood);paint(cap(q,vec2(.19,.06),vec2(.19,.42),.045),wood);" +
    "paint(box(q,vec2(0.,.33),vec2(.17,.03),.02),wood);paint(box(q,vec2(0.,.5),vec2(.15,.13),.04),wood*.8);}" +
    "if(pose>2.5&&pose<3.5){paint(cap(q,vec2(-.1,.33),vec2(-.13,0.),.014),wood);paint(cap(q,vec2(.1,.33),vec2(.13,0.),.014),wood);" +
    "paint(box(q,vec2(0.,.35),vec2(.15,.025),.02),wood);}" +
    "if(Q.y>1.5&&Q.y<2.5)paint(uc(q,hd+vec2(0.,.01),hd-vec2(0.,.2),.095,.075),hr);" +
    "if(Q.y>2.5)paint(length(q-hd-vec2(0.,.015))-.112,hr);" +
    // Legs and shoes.
    "if(sit){paint(uc(q,vec2(-.055,.42),vec2(-.12,.35),.058,.048),pa);paint(uc(q,vec2(.055,.42),vec2(.12,.35),.058,.048),pa);" +
    "paint(uc(q,vec2(-.12,.34),vec2(-.11,.07),.046,.034),pa);paint(uc(q,vec2(.12,.34),vec2(.11,.07),.046,.034),pa);" +
    "paint(cap(q,vec2(-.13,.03),vec2(-.09,.03),.03),shoe);paint(cap(q,vec2(.09,.03),vec2(.13,.03),.03),shoe);}" +
    "else{float lx=skirt?.045:.058;" +
    "paint(uc(q,vec2(-lx,.5),vec2(-.065,.06),skirt?.035:.056,.036),skirt?sk*.9:pa);paint(uc(q,vec2(lx,.5),vec2(.065,.06),skirt?.035:.056,.036),skirt?sk*.9:pa);" +
    "paint(cap(q,vec2(-.1,.028),vec2(-.055,.028),.03),shoe);paint(cap(q,vec2(.055,.028),vec2(.1,.028),.03),shoe);" +
    "if(skirt)paint(uc(q,vec2(0.,.6),vec2(0.,.3),.1,.17),pa);}" +
    // Torso: broader at the shoulders, then the neck.
    "paint(uc(q,vec2(0.,.56+L),vec2(0.,.74+L),.1,.135),sh);" +
    "paint(cap(q,vec2(0.,.78+L),vec2(0.,.84+L),.032),sk*.85);" +
    // Arms: shoulder, elbow, hand per pose; sleeves in the shirt, hands in skin.
    "vec2 sl=vec2(-.13,.76+L),sr=vec2(.13,.76+L),el=vec2(-.17,.61+L),hl=vec2(-.17,.47+L),er=vec2(.17,.61+L),hrr=vec2(.17,.47+L);" +
    "if(pose>1.5&&pose<2.5){el=vec2(-.16,.6+L);hl=vec2(-.06,.67+L);er=vec2(.16,.6+L);hrr=vec2(.06,.67+L);}" +
    "if(pose>0.5&&pose<1.5){er=vec2(.25,.86+L);hrr=vec2(.23,1.02+L);}" +
    "if(pose>4.5){er=vec2(.22,.66+L);hrr=vec2(.31,.75+L);}" +
    "if(pose>3.5&&pose<4.5){hl=vec2(-.2,.44+L);hrr=vec2(.2,.44+L);}" +
    "paint(uc(q,sl,el,.044,.036),sh);paint(uc(q,el,hl,.036,.028),sh);paint(length(q-hl)-.03,sk);" +
    "paint(uc(q,sr,er,.044,.036),sh);paint(uc(q,er,hrr,.036,.028),sh);paint(length(q-hrr)-.03,sk);" +
    // A phone lights the face from below.
    "bool phone=pose>1.5&&pose<2.5;if(phone)paint(box(q,vec2(0.,.7+L),vec2(.06,.04),.012),TEAL*.8);" +
    // Head: a slightly long oval, then hair over the top.
    "paint(length((q-hd)*vec2(1.,.9))-.085,sk*(phone?1.:.95)+(phone?TEAL*.12:vec3(0)));" +
    "if(Q.y<.5||(Q.y>1.5&&Q.y<2.5))paint(max(length((q-hd)*vec2(1.,.9))-.093,-(q.y-hd.y-.02+.03*q.x/.09)),hr);" +
    "if(Q.y>.5&&Q.y<1.5){paint(length(q-hd-vec2(0.,.105))-.038,hr);paint(max(length((q-hd)*vec2(1.,.9))-.09,-(q.y-hd.y-.035)),hr);}" +
    "}" +

    "void main(){vec2 fc=gl_FragCoord.xy;float y=fc.y/uRes.y;C=vec3(0);A=0.;" +
    "float lw=.75*uDpr,la=1.*uDpr;" +
    "float Ar=uArch,ai=floor(fc.x/Ar),px=fc.x-ai*Ar-Ar*.5,R=Ar*.4,spring=uGround+uRes.y*.3,top=spring+R+uRes.y*.05;" +
    // The hall: a wall from the floor up to a cornice, pierced by arched windows.
    "bool win=abs(px)<R&&fc.y>uGround&&(fc.y<spring||length(vec2(px,fc.y-spring))<R);" +
    "if(fc.y<top&&!win){float k=(fc.y-uGround)/(top-uGround);cover(mix(vec3(.13,.1,.24),vec3(.07,.05,.15),k),1.);}" +
    "float dc=fc.y>uGround&&fc.y<spring?abs(abs(px)-R):1e5,da=fc.y>=spring?abs(length(vec2(px,fc.y-spring))-R):1e5;" +
    "cover(VIOLET*.8,1.-smoothstep(lw,lw+la,min(dc,da)));" +
    "float R2=R*1.08,dc2=fc.y>uGround&&fc.y<spring?abs(abs(px)-R2):1e5,da2=fc.y>=spring?abs(length(vec2(px,fc.y-spring))-R2):1e5;" +
    "cover(VIOLET*.55,(1.-smoothstep(lw,lw+la,min(dc2,da2)))*.6);" +
    "cover(VIOLET*.8,(1.-smoothstep(lw,lw+la,abs(fc.y-top)))*.35);cover(VIOLET*.5,(1.-smoothstep(lw,lw+la,abs(fc.y-top+6.*uDpr)))*.22);" +
    // Floor: lighter near the wall, with receding boards.
    "if(fc.y<uGround){float k=(uGround-fc.y)/uGround;vec3 f=mix(vec3(.15,.12,.26),vec3(.07,.05,.14),k);" +
    "float r=fract(sqrt(k)*7.);f+=VIOLET*.06*(1.-smoothstep(0.,.04,min(r,1.-r)));cover(f,1.);}" +
    "cover(VIOLET*.9,(1.-smoothstep(lw,lw+la,abs(fc.y-uGround)))*.35);" +
    // Potted plants between the windows.
    "float bi=floor(fc.x/Ar+.5),bx=fc.x-bi*Ar;if(mod(bi,2.)>.5){float s=uRes.y*.22;vec2 q=vec2(bx,fc.y-uGround)/s;W_=lw/s;AA=la/s;SH=.14;" +
    "for(int i=0;i<9;i++){float a=-1.25+float(i)*.31;vec2 tip=vec2(sin(a)*.6,.25+cos(a)*.75);paint(uc(q,vec2(0.,.22),tip,.02,.05+.02*(1.-abs(a))),mix(TEAL,BLUE,float(i&1))*.5);}" +
    "paint(uc(q,vec2(0.,.2),vec2(0.,.02),.13,.09),ROSE*.45);}" +
    // Lamps in every other window, hung high and behind the people: the cord
    // and bulb here, the light they throw on the room after the people.
    "bool lamp=mod(ai,2.)<.5;float g=length(vec2(px,fc.y-spring-R*.4));" +
    "if(lamp){float dl=fc.y>spring+R*.4&&fc.y<spring+R?abs(px):1e5;cover(INK*.7,(1.-smoothstep(lw*.5,lw*.5+la,dl))*.7);" +
    "cover(GOLD,smoothstep(Ar*.024,Ar*.02,g));cover(vec3(1.,1.,.9),smoothstep(Ar*.012,Ar*.008,g));}" +
    // Soft contact shadows, then the people, back row first (the JS sorts them).
    "for(int i=0;i<" + MAX_PEOPLE + ";i++){if(i>=uN)break;vec4 P=uP[i];float dx=fc.x-P.x;dx-=uRes.x*floor(dx/uRes.x+.5);" +
    "vec2 e=vec2(dx/(P.z*.3),(fc.y-P.y)/(P.z*.045));C*=1.-.5*exp(-dot(e,e));}" +
    "for(int i=0;i<" + MAX_PEOPLE + ";i++){if(i>=uN)break;vec4 P=uP[i];float dx=fc.x-P.x;dx-=uRes.x*floor(dx/uRes.x+.5);" +
    "float s=P.z;if(abs(dx)>s*.42||fc.y<P.y-2.||fc.y>P.y+s*1.1)continue;" +
    "W_=.7*uDpr/s;AA=.9*uDpr/s;SH=.14;person(vec2(dx,fc.y-P.y)/s,P,uQ[i]);}" +
    "if(lamp)C+=GOLD*(.35*exp(-g/(Ar*.06))+.1*exp(-g/(Ar*.3)))*A;" +
    "o=vec4(C,A);}";

  // A frame: the moving sky, the hall over it, everything dimmed under the copy.
  var MAIN = "#version 300 es\\nprecision highp float;out vec4 o;" +
    "uniform sampler2D uTile;uniform vec2 uRes,uView;uniform float uOff,uFade,uTime;" +
    "float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}" +
    "float h1(float n){return fract(sin(n*91.7)*43758.5453);}" +
    "float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}" +
    "float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}" +
    // Twinkling stars in a layer that drifts with the scroll, slower than the hall.
    "vec3 stars(vec2 fc,float cell,float th,float par){vec2 p=(fc+vec2(uOff*par,0.))/(cell*uView.y),id=floor(p);" +
    "if(h(id+7.7)<th)return vec3(0);vec2 c=.2+.6*vec2(h(id),h(id+3.1));float d=length(fract(p)-c)*cell;" +
    "float b=h(id+1.7),tw=.55+.45*sin(uTime*(.7+2.5*h(id+5.3))+6.28*h(id+9.1));" +
    "return mix(vec3(.8,.85,1.),vec3(1.,.9,.75),step(.8,h(id+2.2)))*b*tw*smoothstep(1.3,0.,d);}" +
    "void main(){vec2 fc=gl_FragCoord.xy;float y=fc.y/uRes.y,dp=uView.y;" +
    "vec4 t=texture(uTile,vec2((fc.x+uOff)/uRes.x,y));" +
    "vec3 c=mix(vec3(.08,.04,.17),vec3(.015,.005,.05),smoothstep(.25,1.,y));" +
    "vec2 q=(fc+vec2(uOff*.05,0.))/(uRes.y*.35);float nb=n2(q+vec2(uTime*.01,0.))*.6+n2(q*2.3)*.4;" +
    "c+=vec3(.667,.498,1.)*pow(nb,3.)*.18+vec3(.055,.667,.627)*pow(n2(q*1.4+5.),4.)*.12;" +
    "float up=smoothstep(.45,1.,y);" +
    "c+=stars(fc,9.,.9,.05)*.55*up+stars(fc,21.,.86,.08)*(.5+.5*up)+stars(fc,53.,.84,.15);" +
    // Shooting stars: three slots, each firing once per period at a random spot.
    "for(int k=0;k<3;k++){float P=(6.+float(k)*3.7)/1.3,tt=uTime+float(k)*2.9,ph=mod(tt,P),sd=floor(tt/P)+float(k)*17.;" +
    "if(ph<1.1){vec2 st=vec2(h1(sd)*uView.x,(.84+.14*h1(sd+1.))*uRes.y);vec2 dir=normalize(vec2(h1(sd+2.)<.5?-1.:1.,-.2));" +
    "vec2 hd=st+dir*ph*uView.x*.55;float len=uView.x*.09*min(ph*3.,1.);" +
    "float d=seg(fc,hd-dir*len,hd);float along=clamp(dot(fc-(hd-dir*len),dir)/len,0.,1.);" +
    "c+=vec3(1.,.95,.85)*smoothstep(1.4*dp,0.,d)*along*along*(1.-ph/1.1);}}" +
    // A satellite crossing every forty seconds or so, with a blinking light.
    "float sx=mod(uTime*14.*dp,uView.x+400.*dp)-200.*dp,sy=uRes.y*(.9-.06*sx/uView.x);" +
    "float ds=length(fc-vec2(sx,sy));c+=vec3(.9,.95,1.)*smoothstep(1.6*dp,0.,ds)*.8+vec3(1.,.4,.4)*smoothstep(2.5*dp,0.,ds)*step(.85,fract(uTime*.8));" +
    "float dim=mix(.4,1.,smoothstep(uFade-120.*dp,uFade+260.*dp,fc.x));" +
    // The site's dot grid (dot-grid-fixed: 2px dots every 20px from the top
    // left, at 12.5%), here between the sky and the hall instead of over both.
    "vec2 g=mod(vec2(fc.x,uRes.y-fc.y),20.*dp)-2.*dp;c=mix(c,vec3(.714,.729,.804),smoothstep(2.*dp,2.*dp-1.,length(g))*.125);" +
    "c=c*(1.-t.a)*mix(dim,1.,.5)+t.rgb*dim;o=vec4(c,1.);}";

  // ---------------------------------------------------------------- setup

  function shader(type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
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

  function init() {
    var glc = canvas();
    gl = glc.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) { glc.remove(); return false; }
    progTile = program(TILE, ["uRes", "uDpr", "uGround", "uArch", "uP", "uQ", "uN"]);
    progMain = program(MAIN, ["uTile", "uRes", "uView", "uOff", "uFade", "uTime"]);
    if (!progTile || !progMain) { glc.remove(); return false; }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    tileTex = gl.createTexture();
    tileFbo = gl.createFramebuffer();
    glc.addEventListener("webglcontextlost", function () { running = false; host.remove(); });
    fx = canvas();
    ctx = fx.getContext("2d");
    return true;
  }

  // ---------------------------------------------------------------- the crowd

  /** Deterministic, so a resize redraws the same hall rather than a new one. */
  function rng(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  var langs = data.cities.filter(function (c, i, all) {
    return all.findIndex(function (d) { return d.lang === c.lang; }) === i;
  });

  /**
   * Keep everyone clear of the plant pots, which stand on the same floor line
   * as their feet and would otherwise read as something to stand on. Plants
   * sit on every other column (odd multiples of the arch period); the shift
   * goes to whichever side the person was already on.
   */
  function clearOfPlants(x, arches) {
    var period = tileW / arches, clear = H * 0.1;
    for (var k = 1; k < arches; k += 2) {
      var d = x - k * period;
      if (Math.abs(d) < clear) return k * period + (d < 0 ? -clear : clear);
    }
    return x;
  }

  function crowd(arches) {
    var r = rng(7), list = [], ground = groundY(), s = Math.min(H * 0.3, 210);
    var n = Math.min(MAX_PEOPLE, Math.round(tileW / (s * 0.62)));
    var poses = [0, 5, 2, 1, 3, 0, 5, 4, 2, 0, 3, 5, 1, 2];
    for (var i = 0; i < n; i++) {
      var back = i % 2 === 1, kid = r() < 0.12;
      var scale = s * (back ? 0.88 : 1) * (kid ? 0.66 : 1);
      var pose = kid ? (r() < 0.5 ? 1 : 0) : poses[i % poses.length];
      list.push({
        x: clearOfPlants((i + 0.5 + (r() - 0.5) * 0.5) * (tileW / n), arches),
        // Everyone stands on the floor in front of the wall: feet below its
        // base line, so drawing them over the plants and arches is the
        // right depth. The back row is just off the wall, the front nearer.
        y: ground + (back ? H * 0.008 : H * 0.03) + r() * H * 0.008,
        s: scale,
        pose: pose,
        shirt: (r() * 5) | 0,
        hair: (r() * 4) | 0,
        skin: (r() * 4) | 0,
        cloth: (r() * 4) | 0,
        back: back,
        lang: langs[(r() * langs.length) | 0],
      });
    }
    // Back row first, then by depth within a row.
    list.sort(function (a, b) { return a.back === b.back ? b.y - a.y : a.back ? -1 : 1; });
    return list;
  }

  /** The floor line: 3rem lower than the first prototype's, for more sky above. */
  function groundY() { return Math.min(H - 44, H * 0.86 + 40); }

  /** Top of a person's head, in tile coordinates. */
  function head(p) { return [p.x, p.y - p.s * (p.pose === 3 || p.pose === 4 ? 0.94 : 1.04)]; }

  // ---------------------------------------------------------------- layout

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

  function layout() {
    var b = host.getBoundingClientRect();
    W = b.width; H = b.height;
    fade = W >= 768 ? copyRight(b) : W;
    fdpr = Math.min(devicePixelRatio || 1, 2);
    gdpr = Math.min(devicePixelRatio || 1, 1.5);
    // One tile is wider than the view, so nobody is ever on screen twice.
    tileW = Math.max(W + 400, 1600);
    var max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (tileW * gdpr > max) gdpr = max / tileW;
    // Even, so the alternating lamps and plants repeat cleanly at the tile seam.
    var arches = Math.max(2, 2 * Math.round(tileW / (H * 0.62) / 2));

    people = crowd(arches);
    var gw = Math.round(tileW * gdpr), gh = Math.round(H * gdpr);
    gl.canvas.width = Math.round(W * gdpr); gl.canvas.height = gh;
    fx.width = Math.round(W * fdpr); fx.height = Math.round(H * fdpr);

    gl.bindTexture(gl.TEXTURE_2D, tileTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tileFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tileTex, 0);
    gl.viewport(0, 0, gw, gh);
    gl.useProgram(progTile.p);
    gl.uniform2f(progTile.u.uRes, gw, gh);
    gl.uniform1f(progTile.u.uDpr, gdpr);
    gl.uniform1f(progTile.u.uGround, (H - groundY()) * gdpr);
    gl.uniform1f(progTile.u.uArch, gw / arches);
    var P = new Float32Array(MAX_PEOPLE * 4), Q = new Float32Array(MAX_PEOPLE * 4);
    people.forEach(function (p, i) {
      P.set([p.x * gdpr, (H - p.y) * gdpr, p.s * gdpr, p.pose], i * 4);
      Q.set([p.shirt, p.hair, p.skin, p.cloth], i * 4);
    });
    gl.uniform4fv(progTile.u.uP, P);
    gl.uniform4fv(progTile.u.uQ, Q);
    gl.uniform1i(progTile.u.uN, people.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------------------------------------------------------------- talk

  var talks = [], placed = [], term = 0, termAt = 0, spawnAt = 0;
  var MAX_TALKS = 4, SAY = 0.5, FLIGHT = 1.2, HOLD = 2.6;

  /** A person's head on screen, or null when they are off it. */
  function onScreen(p) {
    var hd = head(p), x = hd[0] - off;
    x -= tileW * Math.floor(x / tileW);
    return x > -60 && x < W + 60 ? [x, hd[1]] : null;
  }

  function busy(p) { return talks.some(function (t) { return t.a === p || t.b === p; }); }

  function word(p) { return p.lang.words[data.terms[term]]; }

  function pick(list) { return list[(Math.random() * list.length) | 0]; }

  function spawn() {
    var lo = Math.max(fade + 40, 40);
    var here = people.filter(function (p) {
      var q = onScreen(p);
      return q && q[0] > lo && q[0] < W - 60 && !busy(p) && word(p);
    });
    if (here.length < 2) return;
    var a = pick(here), qa = onScreen(a);
    var near = here.filter(function (p) {
      var dx = Math.abs(onScreen(p)[0] - qa[0]);
      return p !== a && p.lang !== a.lang && dx > 70 && dx < 460;
    });
    if (!near.length) return;
    var b = pick(near);
    talks.push({ a: a, b: b, t0: clock, wa: word(a), wb: word(b) });
  }

  function bubble(p, text, rtl, alpha, warm) {
    var q = onScreen(p);
    if (!q || alpha <= 0) return;
    ctx.font = "500 15px 'Noto Sans', system-ui, sans-serif";
    ctx.direction = rtl ? "rtl" : "ltr";
    var w = ctx.measureText(text).width, bw = w + 20, bh = 28;
    var x = Math.max(4, Math.min(W - bw - 4, q[0] - bw / 2)), y = q[1] - bh - 14;
    var box = [x, y, x + bw, y + bh];
    if (placed.some(function (o) { return box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3]; })) return;
    placed.push(box);
    var pop = Math.min(1, alpha * 3);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(q[0], q[1] - 6);
    ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop);
    ctx.translate(-q[0], -(q[1] - 6));
    ctx.fillStyle = warm ? "rgba(43,7,88,0.9)" : "rgba(17,2,37,0.88)";
    ctx.strokeStyle = "rgba(" + (warm ? GOLD : VIOLET) + ",0.7)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, 14);
    ctx.moveTo(q[0] - 6, y + bh); ctx.lineTo(q[0], y + bh + 9); ctx.lineTo(q[0] + 6, y + bh);
    ctx.fill(); ctx.stroke();
    // Paint over the seam between the box and its tail.
    ctx.fillRect(q[0] - 5, y + bh - 1.5, 10, 2);
    ctx.fillStyle = "#fff";
    ctx.textAlign = rtl ? "right" : "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, rtl ? x + bw - 10 : x + 10, y + bh / 2 + 1);
    ctx.restore();
  }

  function drawTalk(t) {
    var age = clock - t.t0, end = SAY + FLIGHT + HOLD;
    if (age > end + 0.6) return false;
    var out = Math.min(1, (end + 0.6 - age) / 0.6);
    bubble(t.a, t.wa, t.a.lang.dir === "rtl", Math.min(1, age / 0.25) * out, false);

    var qa = onScreen(t.a), qb = onScreen(t.b);
    var k = (age - SAY) / FLIGHT;
    if (qa && qb && k > 0 && k < 1.5) {
      var ax = qa[0], ay = qa[1] - 8, bx = qb[0], by = qb[1] - 8;
      var cx = (ax + bx) / 2, cy = Math.min(ay, by) - 50 - Math.abs(bx - ax) * 0.15;
      var hk = Math.min(k, 1), tail = Math.max(0, Math.min(1, k - 0.45)), steps = 26, pts = [];
      for (var i = 0; i <= steps; i++) {
        var s = tail + (hk - tail) * (i / steps), u = 1 - s;
        pts.push([u * u * ax + 2 * u * s * cx + s * s * bx, u * u * ay + 2 * u * s * cy + s * s * by]);
      }
      for (var pass = 0; pass < 2; pass++) {
        for (var j = 1; j <= steps; j++) {
          var f = j / steps;
          ctx.strokeStyle = pass
            ? "rgba(" + (f > 0.75 ? GOLD : TEAL) + "," + (0.25 + 0.75 * f) + ")"
            : "rgba(" + VIOLET + "," + 0.2 * f + ")";
          ctx.lineWidth = pass ? 1 + 1.6 * f : 4 + 6 * f;
          ctx.beginPath(); ctx.moveTo(pts[j - 1][0], pts[j - 1][1]); ctx.lineTo(pts[j][0], pts[j][1]); ctx.stroke();
        }
      }
      if (k < 1) {
        var tip = pts[steps], g = ctx.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], 9);
        g.addColorStop(0, "rgba(255,255,240,0.95)");
        g.addColorStop(0.3, "rgba(" + GOLD + ",0.6)");
        g.addColorStop(1, "rgba(" + GOLD + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(tip[0], tip[1], 9, 0, 7); ctx.fill();
      }
    }
    if (age > SAY + FLIGHT) {
      bubble(t.b, t.wb, t.b.lang.dir === "rtl", Math.min(1, (age - SAY - FLIGHT) / 0.25) * out, true);
    }
    return true;
  }

  // ---------------------------------------------------------------- frame

  function draw() {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(progMain.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tileTex);
    gl.uniform1i(progMain.u.uTile, 0);
    gl.uniform2f(progMain.u.uRes, tileW * gdpr, gl.canvas.height);
    gl.uniform2f(progMain.u.uView, W * gdpr, gdpr);
    gl.uniform1f(progMain.u.uOff, (off % tileW) * gdpr);
    gl.uniform1f(progMain.u.uFade, fade * gdpr);
    gl.uniform1f(progMain.u.uTime, clock);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    ctx.setTransform(fdpr, 0, 0, fdpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    placed = [];
    talks = talks.filter(drawTalk);
  }

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    if (now - last < 32) return;
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    off += SPEED * dt;
    if (clock - termAt > 10) { term = (term + 1) % data.terms.length; termAt = clock; }
    if (clock > spawnAt && talks.length < MAX_TALKS) { spawn(); spawnAt = clock + 0.7 + Math.random() * 0.8; }
    draw();
  }

  function play() {
    if (still || running || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }

  function start() {
    if (!init()) return;
    layout();
    if (still) {
      // One composed frame: two exchanges already landed.
      for (var i = 0; i < 2; i++) spawn();
      clock = SAY + FLIGHT + 1;
      talks.forEach(function (t) { t.t0 = 0; });
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
    play();
  }

  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
`
