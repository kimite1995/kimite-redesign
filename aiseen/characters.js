/* Aiseen 3D 캐릭터 모듈
   - 화면 전체를 덮는 투명 캔버스 1장에 모든 캐릭터를 그린다.
   - 캐릭터 위치는 HTML의 빈 요소(.slot)가 정한다: slot의 아래 변 = 캐릭터가 걸터앉는 선,
     slot의 너비 = 캐릭터 크기. 그래서 레이아웃은 CSS로만 잡으면 된다.
   - 선 아래는 클리핑으로 잘려서 "모서리 너머로 빼꼼" 보인다.
   - 동작은 inst.S(상태값)만 바꾸면 된다. 스크롤로 직접 넣거나 act.*() 트윈을 쓴다. */
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const gsap = window.gsap;
export const BLUE = '#2F6BFF';

/* 로고 원본(24×24)은 그대로, 눈과 손만 추가.
   eye: 두 눈 중심 [u, v] (로고 좌표), gap: 눈 사이 간격 */
export const DEFS = {
  chatgpt:    { name:'ChatGPT',    file:'openai.svg',       color:'#1A1A1A', ink:'#0D0D0D', glow:'#10A37F', bevel:.18, eye:[12, 12],   gap:4.8, idle:'sway' },
  gemini:     { name:'Gemini',     file:'googlegemini.svg', grad:['#4285F4', '#9B72CB'], ink:'#5B6FD6', glow:'#9B72CB', bevel:.35, eye:[12, 11.4], gap:3.6, idle:'bounce' },
  aiseen:     { name:'Aiseen',     builtin:true,            color:BLUE,      ink:BLUE,      glow:BLUE, idle:'antenna' },
  claude:     { name:'Claude',     file:'claude.svg',       color:'#D97757', ink:'#A9502F', glow:'#D97757', bevel:.16, eye:[12, 12.2], gap:5.0, idle:'nod' },
  perplexity: { name:'Perplexity', file:'perplexity.svg',   color:'#1FB8CD', ink:'#127C8A', glow:'#1FB8CD', bevel:.14, eye:[12, 11.6], gap:5.2, idle:'look' },
};
const LINE_V = 19;          // 로고 좌표에서 선이 지나는 높이
const K = 1.7 / 24;         // 로고 1단위 → 3D 크기
const UNIT = 2.0;           // slot 너비에 해당하는 3D 폭 (손 포함)

const clamp01 = v => Math.min(1, Math.max(0, v));

function idleOf(c, ph, t) {
  const o = { bob:Math.sin(t * 1.7 + ph), sway:0, nod:0, look:0, pulse:0, antenna:0 };
  if (c.idle === 'sway')    o.sway = Math.sin(t * .8 + ph);
  if (c.idle === 'bounce')  { o.bob = Math.abs(Math.sin(t * 2.4 + ph)) * 2 - .6; o.pulse = Math.sin(t * 4.8 + ph); }
  if (c.idle === 'nod')     o.nod = Math.sin(t * 2.2 + ph);
  if (c.idle === 'look')    { const k = Math.sin(t * .9 + ph); o.look = Math.sign(k) * Math.min(1, Math.abs(k) * 2.2); }
  if (c.idle === 'antenna') o.antenna = Math.sin(t * 3.1 + ph);
  return o;
}

export async function createCast(canvas, { logoBase = 'assets/logos/' } = {}) {
  await Promise.all(Object.values(DEFS).filter(c => c.file && !c.svg).map(async c => {
    c.svg = await (await fetch(logoBase + c.file)).text();
  }));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe6f2, .7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(3, 7, 9);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(18, 1, 1, 200);
  const DIST = 40;
  camera.position.set(0, 0, DIST);

  /* 공용 도형 (한 번만 만든다) */
  const G = {
    pill:   new THREE.CapsuleGeometry(.066, .085, 6, 16),
    arc:    new THREE.TorusGeometry(.072, .025, 8, 24, Math.PI),
    hand:   new THREE.SphereGeometry(.16, 32, 16),
    finger: new THREE.CapsuleGeometry(.013, .05, 4, 8),
    dome:   new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
    base:   new THREE.CylinderGeometry(1, 1, 2, 64, 1, true),
    face:   new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    stick:  new THREE.CylinderGeometry(.045, .045, .32, 16),
    ball:   new THREE.SphereGeometry(.12, 32, 16),
    spark:  new THREE.CapsuleGeometry(.05, .14, 6, 12),
    logos:  {},
  };
  for (const [id, c] of Object.entries(DEFS)) {
    if (!c.file) continue;
    const data = new SVGLoader().parse(c.svg);
    const shapes = data.paths.flatMap(p => SVGLoader.createShapes(p));
    const geo = new THREE.ExtrudeGeometry(shapes, { depth:2, bevelEnabled:true, bevelThickness:.5, bevelSize:c.bevel, bevelSegments:5, curveSegments:28 });
    geo.translate(-12, -LINE_V, -1);
    geo.scale(K, -K, -K);                       // y·z 동시 반전 = 회전 → 면 방향 유지
    geo.computeVertexNormals();
    if (c.grad) {
      const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
      const a = new THREE.Color(c.grad[0]), b = new THREE.Color(c.grad[1]), tmp = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        const tt = clamp01(((pos.getX(k) + .85) / 1.7 + (pos.getY(k) + .35) / 1.7) / 2);
        tmp.copy(a).lerp(b, tt); col.set([tmp.r, tmp.g, tmp.b], k * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    G.logos[id] = geo;
  }
  const glowTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx;
  })();

  const insts = [];

  function build(id, slot) {
    const c = DEFS[id];
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const clip = [plane];
    const P = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
      color, roughness:.42, metalness:0, clearcoat:.55, clearcoatRoughness:.35, envMapIntensity:.8, clippingPlanes:clip, ...extra });
    const Bm = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, clippingPlanes:clip, ...extra });
    const white = P('#ffffff', { roughness:.35 });
    const inst = {
      id, c, slot, plane,
      S:{ rise:0, open:1, lid:1, look:0, tilt:0, happy:0, glow:0, hop:0, wave:0, spark:0 },
      ph:Math.random() * 6.28, nextBlink:2 + Math.random() * 3, mats:[],
    };
    const root = inst.root = new THREE.Group(); scene.add(root);
    const body = inst.body = new THREE.Group(); root.add(body);
    const glow = inst.glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTex, color:c.glow, transparent:true, opacity:0, depthWrite:false, clippingPlanes:clip }));
    glow.scale.set(2.6, 2.6, 1); glow.position.set(0, .65, -.6); root.add(glow);

    const eyes = (positions, z, eyeColor, outline) => positions.map(([x, y]) => {
      const g = new THREE.Group(); g.position.set(x, y, z); body.add(g);
      const open = new THREE.Group(); g.add(open);
      const e = new THREE.Mesh(G.pill, P(eyeColor, { roughness:.3 })); e.scale.z = .55; open.add(e);
      if (outline) { const ol = new THREE.Mesh(G.pill, Bm(c.ink)); ol.scale.set(1.3, 1.18, .4); ol.position.z = -.012; open.add(ol); }
      const happy = new THREE.Mesh(G.arc, P(outline ? '#ffffff' : eyeColor));
      happy.position.y = -.025; happy.visible = false; g.add(happy);
      return { open, happy };
    });

    if (c.builtin) {
      const blue = P(BLUE, { emissive:new THREE.Color(BLUE), emissiveIntensity:0 }); inst.mats.push(blue);
      const dome = new THREE.Mesh(G.dome, blue); dome.scale.set(.9, 1.07, .7);
      const base = new THREE.Mesh(G.base, blue); base.scale.set(.9, 1, .7); base.position.y = -1;
      const face = new THREE.Mesh(G.face, white); face.scale.set(.64, .76, .2); face.position.z = .56;
      const ant = inst.antenna = new THREE.Group(); ant.position.y = 1.0;
      const stick = new THREE.Mesh(G.stick, blue); stick.position.y = .16;
      const ball = new THREE.Mesh(G.ball, blue); ball.position.y = .38;
      ant.add(stick, ball);
      inst.sparkMat = P('#C9D6F7', { emissive:new THREE.Color(BLUE), emissiveIntensity:0 });
      const sparks = [[.68, 1.24, .95], [.92, .98, .42]].map(([x, y, a]) => {
        const m = new THREE.Mesh(G.spark, inst.sparkMat); m.position.set(x, y, .25); m.rotation.z = -a; return m;
      });
      body.add(dome, base, face, ant, ...sparks);
      inst.eyes = eyes([[-.24, .42], [.24, .42]], .76, BLUE, false);
      inst.handX = .74; inst.handZ = .5;
    } else {
      const mat = c.grad
        ? P('#ffffff', { vertexColors:true, emissive:new THREE.Color(c.glow), emissiveIntensity:0 })
        : P(c.color,   { emissive:new THREE.Color(c.glow), emissiveIntensity:0 });
      inst.mats.push(mat);
      body.add(new THREE.Mesh(G.logos[id], mat));
      const [u, v] = c.eye;
      inst.eyes = eyes([-c.gap / 2, c.gap / 2].map(du => [(u + du - 12) * K, -(v - LINE_V) * K]), 1.5 * K + .03, '#ffffff', true);
      inst.handX = .62; inst.handZ = .22;
    }
    const inkBack = Bm(c.ink, { side:THREE.BackSide }), ink = Bm(c.ink);
    inst.hands = [-1, 1].map(side => {
      const h = new THREE.Group();
      const m = new THREE.Mesh(G.hand, white); m.scale.set(1.15, .72, .9); m.position.y = .115;
      const ol = new THREE.Mesh(G.hand, inkBack); ol.scale.set(1.15 * 1.12, .72 * 1.16, .9 * 1.1); ol.position.y = .115;
      const fingers = [-.065, .065].map(fx => { const f = new THREE.Mesh(G.finger, ink); f.position.set(fx, .055, .13); return f; });
      h.add(m, ol, ...fingers);
      h.position.set(side * inst.handX, 0, inst.handZ);
      root.add(h);
      return h;
    });
    return inst;
  }

  /** slot 요소 하나에 캐릭터 하나를 붙인다 */
  function add(slot, id = slot.dataset.char) { const i = build(id, slot); insts.push(i); return i; }

  const mouse = { x:innerWidth / 2, y:innerHeight / 2, on:false };
  if (matchMedia('(hover: hover)').matches) {
    addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; }, { passive:true });
  }

  let W = 0, H = 0, wasDrawn = true;
  function render(t) {
    if (innerWidth !== W || innerHeight !== H) {
      W = innerWidth; H = innerHeight;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
    }
    const wpp = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / H;   // 화면 1px = 3D 몇 단위
    let any = false;
    for (const i of insts) {
      const r = i.slot.getBoundingClientRect();
      const vis = r.width > 0 && i.S.rise > .001 && r.bottom > -r.width && r.top < H + r.width * 2;
      i.root.visible = vis;
      if (!vis) continue;
      any = true;
      const s = r.width * wpp / UNIT;
      const cx = r.left + r.width / 2;
      const ly = (H / 2 - r.bottom) * wpp;
      i.root.position.set((cx - W / 2) * wpp, ly, 0);
      i.root.scale.setScalar(s);
      i.plane.constant = -ly + .004 * s;                   // 선 아래는 잘라냄

      const S = i.S, o = idleOf(i.c, i.ph, t);
      if (t > i.nextBlink) {                                // 가끔 저절로 깜빡
        i.nextBlink = t + 2.2 + Math.random() * 2.8;
        if (S.rise > .99 && S.happy < .01) act.blink(i);
      }
      const mx = mouse.on ? Math.max(-1, Math.min(1, (mouse.x - cx) / (W * .45))) : 0;
      const my = mouse.on ? Math.max(-1, Math.min(1, (mouse.y - r.bottom) / (H * .5))) : 0;
      const b = i.body;
      b.position.y = -(1 - S.rise) * 1.8 + S.hop * .36 + o.bob * .022;
      b.rotation.z = THREE.MathUtils.degToRad(-S.tilt);
      b.rotation.y = o.sway * .38 + (S.look + o.look) * .3 + mx * .4;
      b.rotation.x = o.nod * .1 + my * .16;
      b.scale.setScalar(1 + o.pulse * .025 + S.hop * .04);
      i.glowSprite.material.opacity = S.glow * .75;
      for (const m of i.mats) m.emissiveIntensity = S.glow * .45;
      const look = (S.look + o.look) * .03;
      const open = Math.max(S.open * S.lid, .08) * (1 - S.happy);
      for (const e of i.eyes) {
        e.open.scale.y = open || .001; e.open.visible = S.happy < .98; e.open.position.x = look;
        e.happy.visible = S.happy > .02; e.happy.scale.set(S.happy, S.happy, .6);
      }
      if (i.antenna) {
        i.antenna.rotation.z = o.antenna * .1;
        i.sparkMat.color.set('#C9D6F7').lerp(new THREE.Color(BLUE), S.spark);
        i.sparkMat.emissiveIntensity = S.spark * .9;
      }
      i.hands.forEach((h, k) => {
        h.position.y = -(1 - S.rise) * .5;
        if (k === 1 && S.wave > 0) { h.position.y += S.wave * .42; h.rotation.z = Math.sin(t * 14 + i.ph) * .45 * S.wave; }
        else h.rotation.z = 0;
      });
    }
    if (any || wasDrawn) renderer.render(scene, camera);   // 아무도 안 보이면 한 번 지우고 쉰다
    wasDrawn = any;
  }

  return { add, render, insts };
}

/* ───────── 동작 (트윈) ───────── */
export const act = {
  peek(i, delay = 0) {
    gsap.to(i.S, { rise:1, duration:.9, ease:'back.out(1.6)', delay, overwrite:'auto' });
    act.blink(i, delay + .95);
  },
  hide(i, delay = 0) {
    gsap.killTweensOf(i.S);
    gsap.to(i.S, { rise:0, duration:.35, ease:'power2.in', delay,
      onComplete:() => Object.assign(i.S, { open:1, lid:1, look:0, tilt:0, happy:0, glow:0, hop:0, wave:0 }) });
  },
  blink(i, delay = 0) {
    gsap.timeline({ delay })
      .to(i.S, { open:.05, duration:.07, ease:'power1.in' })
      .to(i.S, { open:1, duration:.11, ease:'power1.out' });
  },
  tilt(i, dir = 1, delay = 0, hold = 1.2) {
    gsap.timeline({ delay })
      .to(i.S, { tilt:14 * dir, look:dir, duration:.45, ease:'back.out(2)' })
      .to(i.S, { tilt:0, look:0, duration:.55, ease:'power2.inOut' }, `+=${hold}`);
  },
  shake(i, delay = 0) {          // 고개 젓기 ("안 돼요")
    gsap.timeline({ delay })
      .to(i.S, { tilt:-11, duration:.14 }).to(i.S, { tilt:11, duration:.2 })
      .to(i.S, { tilt:-8, duration:.18 }).to(i.S, { tilt:6, duration:.16 })
      .to(i.S, { tilt:0, duration:.22, ease:'power2.out' });
  },
  lookAround(i, delay = 0) {
    gsap.timeline({ delay })
      .to(i.S, { look:-1, duration:.3 }).to(i.S, { look:1, duration:.45 }, '+=.35')
      .to(i.S, { look:0, tilt:12, duration:.4, ease:'back.out(2)' }, '+=.35');
  },
  droop(i, delay = 0) {          // 힘이 빠짐 (반쯤 가라앉고 눈이 반쯤 감김)
    gsap.to(i.S, { rise:.62, lid:.42, duration:1.1, ease:'power2.inOut', delay });
  },
  lightUp(i, delay = 0, keep = false) {
    const tl = gsap.timeline({ delay })
      .to(i.S, { hop:1, duration:.2, ease:'power2.out' })
      .to(i.S, { hop:0, duration:.45, ease:'bounce.out' })
      .to(i.S, { happy:1, glow:1, duration:.22 }, 0)
      .to(i.S, { glow:0, duration:.9 }, .9);
    if (!keep) tl.to(i.S, { happy:0, duration:.25 }, 2.4);
    if (i.c.builtin) act.spark(i, delay + .1);
  },
  spark(i, delay = 0) {          // 안테나 반짝이: 전원 켜지듯 깜빡이다 켜짐
    gsap.timeline({ delay })
      .set(i.S, { spark:.9 }).set(i.S, { spark:.1 }, .07).set(i.S, { spark:1 }, .14)
      .set(i.S, { spark:.3 }, .22).to(i.S, { spark:1, duration:.15 }, .3);
  },
  wave(i, delay = 0, hold = 1.6) {
    gsap.timeline({ delay })
      .to(i.S, { wave:1, duration:.3, ease:'back.out(2)' })
      .to(i.S, { wave:0, duration:.35, ease:'power2.in' }, `+=${hold}`);
  },
};
