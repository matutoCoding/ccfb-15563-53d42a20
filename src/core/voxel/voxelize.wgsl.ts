/**
 * WebGPU 计算着色器：每线程处理一个三角形
 * 与 CPU 路径相同的 SAT 三角-AABB 重叠测试，命中的体素原子占位
 * uniform: gridOrigin(xyz) + voxelSize(w)
 */
export const VOXELIZE_WGSL = /* wgsl */ `
struct Uniforms {
  origin: vec3<f32>,
  voxelSize: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> occupancy: array<u32>;
@group(0) @binding(4) var<storage, read> gridSize: array<u32>;

fn sub(a: vec3<f32>, b: vec3<f32>) -> vec3<f32> { return a - b; }

fn plane_ok(axis: vec3<f32>, p0: vec3<f32>, p1: vec3<f32>, p2: vec3<f32>, r: f32) -> bool {
  let d0 = dot(p0, axis);
  let d1 = dot(p1, axis);
  let d2 = dot(p2, axis);
  let lo = min(min(d0, d1), d2);
  let hi = max(max(d0, d1), d2);
  return !(lo > r || hi < -r);
}

fn tri_box_overlap(center: vec3<f32>, half: vec3<f32>, a: vec3<f32>, b: vec3<f32>, d: vec3<f32>) -> bool {
  let v0 = sub(a, center);
  let v1 = sub(b, center);
  let v2 = sub(d, center);
  let e0 = sub(v1, v0);
  let e1 = sub(v2, v1);
  let e2 = sub(v0, v2);

  let mn = min(min(v0, v1), v2);
  let mx = max(max(v0, v1), v2);
  if (mn.x > half.x || mx.x < -half.x ||
      mn.y > half.y || mx.y < -half.y ||
      mn.z > half.z || mx.z < -half.z) {
    return false;
  }

  let ax = vec3<f32>(1.0, 0.0, 0.0);
  let ay = vec3<f32>(0.0, 1.0, 0.0);
  let az = vec3<f32>(0.0, 0.0, 1.0);

  let tests = array<vec3<f32>, 9>(
    cross(ax, e0), cross(ay, e0), cross(az, e0),
    cross(ax, e1), cross(ay, e1), cross(az, e1),
    cross(ax, e2), cross(ay, e2), cross(az, e2)
  );
  let radii = array<f32, 9>(
    half.y * abs(e0.z) + half.z * abs(e0.y),
    half.x * abs(e0.z) + half.z * abs(e0.x),
    half.x * abs(e0.y) + half.y * abs(e0.x),
    half.y * abs(e1.z) + half.z * abs(e1.y),
    half.x * abs(e1.z) + half.z * abs(e1.x),
    half.x * abs(e1.y) + half.y * abs(e1.x),
    half.y * abs(e2.z) + half.z * abs(e2.y),
    half.x * abs(e2.z) + half.z * abs(e2.x),
    half.x * abs(e2.y) + half.y * abs(e2.x)
  );

  for (var i: u32 = 0u; i < 9u; i++) {
    if (!plane_ok(tests[i], v0, v1, v2, radii[i])) {
      return false;
    }
  }
  return true;
}

fn load_vert(vi: u32) -> vec3<f32> {
  let base = vi * 3u;
  return vec3<f32>(positions[base], positions[base + 1u], positions[base + 2u]);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tri = gid.x;
  let triCount = arrayLength(&indices) / 3u;
  if (tri >= triCount) {
    return;
  }

  let i0 = indices[tri * 3u];
  let i1 = indices[tri * 3u + 1u];
  let i2 = indices[tri * 3u + 2u];
  let p0 = load_vert(i0);
  let p1 = load_vert(i1);
  let p2 = load_vert(i2);

  // 三角形包围盒 -> 格坐标扫描范围，避免全网格遍历
  let lo = min(min(p0, p1), p2);
  let hi = max(max(p0, p1), p2);
  let s = uniforms.voxelSize;
  let o = uniforms.origin;

  var x0 = u32(clamp(floor((lo.x - o.x) / s), 0.0, f32(gridSize[0]) - 1.0));
  var x1 = u32(clamp(floor((hi.x - o.x) / s), 0.0, f32(gridSize[0]) - 1.0));
  var y0 = u32(clamp(floor((lo.y - o.y) / s), 0.0, f32(gridSize[1]) - 1.0));
  var y1 = u32(clamp(floor((hi.y - o.y) / s), 0.0, f32(gridSize[1]) - 1.0));
  var z0 = u32(clamp(floor((lo.z - o.z) / s), 0.0, f32(gridSize[2]) - 1.0));
  var z1 = u32(clamp(floor((hi.z - o.z) / s), 0.0, f32(gridSize[2]) - 1.0));

  let half = vec3<f32>(s * 0.5);
  let nx = gridSize[0];
  let nxy = gridSize[0] * gridSize[1];

  for (var z = z0; z <= z1; z++) {
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        let center = vec3<f32>(
          o.x + (f32(x) + 0.5) * s,
          o.y + (f32(y) + 0.5) * s,
          o.z + (f32(z) + 0.5) * s
        );
        if (tri_box_overlap(center, half, p0, p1, p2)) {
          let idx = x + nx * y + nxy * z;
          atomicOr(&occupancy[idx], 1u);
        }
      }
    }
  }
}
`
