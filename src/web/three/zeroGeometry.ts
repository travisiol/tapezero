// The TAPEZERO symbol: a slanted, puffy rounded-rectangle zero with a clear centre,
// and a second layer on its upper-right edge (the "doubled frame").
import * as THREE from 'three';

/** Points of a rounded rectangle contour, counter-clockwise, starting at the middle of the right edge. */
function roundedRectPoints(w: number, h: number, r: number, seg = 18): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const hw = w / 2;
  const hh = h / 2;
  const corners = [
    [hw - r, hh - r, 0], // top-right
    [-hw + r, hh - r, Math.PI / 2], // top-left
    [-hw + r, -hh + r, Math.PI], // bottom-left
    [hw - r, -hh + r, (3 * Math.PI) / 2], // bottom-right
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  }
  return pts;
}

const SLANT = 0.2; // italic shear, same direction as the logo

function shear(pts: THREE.Vector2[]) {
  return pts.map((p) => new THREE.Vector2(p.x + p.y * SLANT, p.y));
}

export const ZERO = { W: 1.62, H: 2.3, R: 0.7, IW: 1.02, IH: 1.72, IR: 0.42 };

export function zeroShape(): THREE.Shape {
  const outer = shear(roundedRectPoints(ZERO.W, ZERO.H, ZERO.R));
  const inner = shear(roundedRectPoints(ZERO.IW, ZERO.IH, ZERO.IR)).reverse();
  const s = new THREE.Shape(outer);
  s.holes.push(new THREE.Path(inner));
  return s;
}

/**
 * The doubled edge: a band following the outer contour on the upper-right corner,
 * from the top edge to the upper part of the right edge.
 */
export function edgeLayerShape(): THREE.Shape {
  const seg = 40;
  const BEV = 0.17; // sit on the bevelled outer rim
  const hw = ZERO.W / 2 + BEV;
  const hh = ZERO.H / 2 + BEV;
  const r = ZERO.R + BEV;
  const band = 0.4;
  const outer: THREE.Vector2[] = [];
  const inner: THREE.Vector2[] = [];
  // top straight part (from x = 0.05 to the corner), the corner arc, then down the right edge
  const push = (x: number, y: number, nx: number, ny: number) => {
    outer.push(new THREE.Vector2(x, y));
    inner.push(new THREE.Vector2(x - nx * band, y - ny * band));
  };
  for (let i = 0; i <= 6; i++) {
    const x = -0.12 + (i / 6) * (hw - r + 0.12);
    // taper the band in at the start, like a peeled layer
    push(x, hh, 0, 1);
  }
  for (let i = 1; i <= seg; i++) {
    const a = Math.PI / 2 - (i / seg) * (Math.PI / 2);
    push(hw - r + Math.cos(a) * r, hh - r + Math.sin(a) * r, Math.cos(a), Math.sin(a));
  }
  for (let i = 1; i <= 6; i++) {
    push(hw, hh - r - (i / 6) * 0.55, 1, 0);
  }
  // taper ends: shrink the band width at both extremities
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const k = Math.min(1, Math.min(t, 1 - t) * 5.5);
    const ease = k * k * (3 - 2 * k);
    inner[i].lerpVectors(outer[i], inner[i], 0.15 + 0.85 * ease);
  }
  const contour = shear([...outer, ...inner.reverse()]);
  return new THREE.Shape(contour);
}

export function zeroGeometry(): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(zeroShape(), {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.26,
    bevelSize: 0.2,
    bevelSegments: 14,
    curveSegments: 32,
  });
  g.translate(0, 0, -0.17);
  g.computeVertexNormals();
  return g;
}

/**
 * The doubled edge as a tapered tube riding the outer rim of the upper-right corner:
 * a second, slightly shifted copy of the edge — like two successive frames.
 */
export function edgeGeometry(): THREE.BufferGeometry {
  const BEV = 0.17;
  const inset = 0.16;
  const hw = ZERO.W / 2 + BEV - inset;
  const hh = ZERO.H / 2 + BEV - inset;
  const r = ZERO.R + BEV - inset;
  const pts: THREE.Vector3[] = [];
  const z = 0.16;
  const add = (x: number, y: number) => pts.push(new THREE.Vector3(x + y * SLANT, y, z));
  for (let i = 0; i <= 4; i++) add(-0.05 + (i / 4) * (hw - r + 0.05), hh);
  for (let i = 1; i <= 16; i++) {
    const a = Math.PI / 2 - (i / 16) * (Math.PI / 2);
    add(hw - r + Math.cos(a) * r, hh - r + Math.sin(a) * r);
  }
  for (let i = 1; i <= 4; i++) add(hw, hh - r - (i / 4) * 0.6);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const TS = 120;
  const RS = 28;
  const R = 0.2;
  const g = new THREE.TubeGeometry(curve, TS, R, RS, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= TS; i++) {
    const t = i / TS;
    const k = Math.min(1, Math.min(t, 1 - t) * 4.5);
    const taper = 0.12 + 0.88 * (k * k * (3 - 2 * k));
    curve.getPointAt(t, c);
    for (let j = 0; j <= RS; j++) {
      const idx = i * (RS + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c);
      v.multiplyScalar(taper);
      v.z *= 0.75; // flatter, like a layer
      v.add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
