/**
 * 三角形 vs 轴对齐包围盒重叠测试（Akenine-Möller SAT）
 * CPU 与 WGSL 计算着色器使用完全相同的算法，保证两条路径结果一致
 * 坐标均为世界坐标，盒中心 c、半边长 h
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

/** 平面 SAT：v0/v1/v2 在轴上投影与盒子投影 [−r, r] 是否分离 */
const planeOverlap = (
  axis: Vec3,
  v0: Vec3,
  v1: Vec3,
  v2: Vec3,
  r: number,
): boolean => {
  const p0 = dot(v0, axis)
  const p1 = dot(v1, axis)
  const p2 = dot(v2, axis)
  const min = Math.min(p0, p1, p2)
  const max = Math.max(p0, p1, p2)
  return !(min > r || max < -r)
}

export const triangleBoxOverlap = (
  c: Vec3,
  h: Vec3,
  a: Vec3,
  b: Vec3,
  d: Vec3,
): boolean => {
  // 平移到以盒中心为原点
  const v0 = sub(a, c)
  const v1 = sub(b, c)
  const v2 = sub(d, c)
  const e0 = sub(v1, v0)
  const e1 = sub(v2, v1)
  const e2 = sub(v0, v2)

  // 三个坐标面：法线即坐标轴
  const min0 = Math.min(v0.x, v1.x, v2.x)
  const max0 = Math.max(v0.x, v1.x, v2.x)
  const min1 = Math.min(v0.y, v1.y, v2.y)
  const max1 = Math.max(v0.y, v1.y, v2.y)
  const min2 = Math.min(v0.z, v1.z, v2.z)
  const max2 = Math.max(v0.z, v1.z, v2.z)
  if (min0 > h.x || max0 < -h.x || min1 > h.y || max1 < -h.y || min2 > h.z || max2 < -h.z) {
    return false
  }

  // 九条边 × 坐标轴的叉积轴
  const axes: Array<[Vec3, number]> = [
    [cross({ x: 1, y: 0, z: 0 }, e0), h.y * Math.abs(e0.z) + h.z * Math.abs(e0.y)],
    [cross({ x: 0, y: 1, z: 0 }, e0), h.x * Math.abs(e0.z) + h.z * Math.abs(e0.x)],
    [cross({ x: 0, y: 0, z: 1 }, e0), h.x * Math.abs(e0.y) + h.y * Math.abs(e0.x)],
    [cross({ x: 1, y: 0, z: 0 }, e1), h.y * Math.abs(e1.z) + h.z * Math.abs(e1.y)],
    [cross({ x: 0, y: 1, z: 0 }, e1), h.x * Math.abs(e1.z) + h.z * Math.abs(e1.x)],
    [cross({ x: 0, y: 0, z: 1 }, e1), h.x * Math.abs(e1.y) + h.y * Math.abs(e1.x)],
    [cross({ x: 1, y: 0, z: 0 }, e2), h.y * Math.abs(e2.z) + h.z * Math.abs(e2.y)],
    [cross({ x: 0, y: 1, z: 0 }, e2), h.x * Math.abs(e2.z) + h.z * Math.abs(e2.x)],
    [cross({ x: 0, y: 0, z: 1 }, e2), h.x * Math.abs(e2.y) + h.y * Math.abs(e2.x)],
  ]

  for (const [axis, r] of axes) {
    if (!planeOverlap(axis, v0, v1, v2, r)) return false
  }
  return true
}
