import { createVolume, finalizeVolume, voxelIndex } from '../grid_utils'
import type { VoxelMesh, VoxelVolume } from '../types'
import { computeGrid, fillInterior, hollowShell, meshBounds } from './pipeline_utils'
import { VOXELIZE_WGSL } from './voxelize.wgsl'

export interface GpuVoxelOptions {
  resolution: number
  shellThickness: number
  voxelMm: number
  onProgress?: (ratio: number) => void
}

export const isWebGpuSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'gpu' in navigator

/** GPU 只负责占用率；颜色采样回 CPU 分箱完成，保证两路径产物同构 */
export const voxelizeGpu = async (
  mesh: VoxelMesh,
  options: GpuVoxelOptions,
): Promise<VoxelVolume> => {
  if (!isWebGpuSupported()) throw new Error('当前浏览器不支持 WebGPU')
  const start = performance.now()
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('未找到可用的 WebGPU 适配器')
  const device = await adapter.requestDevice()

  const { resolution, shellThickness, voxelMm } = options
  const { min, max } = meshBounds(mesh.positions)
  const { size, voxelSize, origin } = computeGrid(min, max, resolution)
  const cellCount = size[0] * size[1] * size[2]
  const vol = createVolume(size, voxelMm, origin)

  // uniform: origin(3f32) + voxelSize(f32)
  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(
    uniformBuffer,
    0,
    new Float32Array([origin[0], origin[1], origin[2], voxelSize]),
  )

  const positionBuffer = device.createBuffer({
    size: mesh.positions.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(positionBuffer, 0, mesh.positions)

  const indexBuffer = device.createBuffer({
    size: mesh.indices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(indexBuffer, 0, mesh.indices)

  const occupancyBuffer = device.createBuffer({
    size: cellCount * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const gridBuffer = device.createBuffer({
    size: 12,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(gridBuffer, 0, new Uint32Array(size))

  const readbackBuffer = device.createBuffer({
    size: cellCount * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  })

  const shaderModule = device.createShaderModule({ code: VOXELIZE_WGSL })
  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  })
  const bindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: indexBuffer } },
      { binding: 3, resource: { buffer: occupancyBuffer } },
      { binding: 4, resource: { buffer: gridBuffer } },
    ],
  })

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(computePipeline)
  pass.setBindGroup(0, bindGroup)
  const triCount = mesh.indices.length / 3
  pass.dispatchWorkgroups(Math.ceil(triCount / 64))
  pass.end()
  encoder.copyBufferToBuffer(occupancyBuffer, 0, readbackBuffer, 0, cellCount * 4)
  device.queue.submit([encoder.finish()])

  options.onProgress?.(0.5)
  await readbackBuffer.mapAsync(GPUMapMode.READ)
  const gpuResult = new Uint32Array(readbackBuffer.getMappedRange().slice(0))
  readbackBuffer.unmap()
  for (let i = 0; i < cellCount; i++) {
    if (gpuResult[i] === 1) vol.occupancy[i] = 1
  }

  sampleColorsCpu(vol, mesh, voxelSize, origin, options.onProgress)
  fillInterior(vol)
  hollowShell(vol, shellThickness)
  finalizeVolume(vol)
  vol.stats.engine = 'webgpu'
  vol.stats.elapsedMs = performance.now() - start

  occupancyBuffer.destroy()
  readbackBuffer.destroy()
  positionBuffer.destroy()
  indexBuffer.destroy()
  uniformBuffer.destroy()
  gridBuffer.destroy()
  device.destroy()
  return vol
}

/** GPU 占位后回 CPU 分箱采样颜色，逻辑与 cpu_voxelizer 保持同源 */
const sampleColorsCpu = (
  vol: VoxelVolume,
  mesh: VoxelMesh,
  voxelSize: number,
  origin: [number, number, number],
  onProgress?: (ratio: number) => void,
): void => {
  const { size, occupancy, sampleRGB } = vol
  const triCount = mesh.indices.length / 3
  const bins: number[][] = Array.from(
    { length: size[0] * size[1] * size[2] },
    () => [],
  )
  const cellRange = (
    lo: number,
    hi: number,
    axis: 0 | 1 | 2,
  ): [number, number] => {
    const c0 = Math.max(0, Math.floor((lo - origin[axis]) / voxelSize))
    const c1 = Math.min(size[axis] - 1, Math.floor((hi - origin[axis]) / voxelSize))
    return [c0, c1]
  }
  for (let t = 0; t < triCount; t++) {
    const ia = mesh.indices[t * 3]
    const ib = mesh.indices[t * 3 + 1]
    const ic = mesh.indices[t * 3 + 2]
    let loX = Infinity
    let hiX = -Infinity
    let loY = Infinity
    let hiY = -Infinity
    let loZ = Infinity
    let hiZ = -Infinity
    for (const vi of [ia, ib, ic]) {
      loX = Math.min(loX, mesh.positions[vi * 3])
      hiX = Math.max(hiX, mesh.positions[vi * 3])
      loY = Math.min(loY, mesh.positions[vi * 3 + 1])
      hiY = Math.max(hiY, mesh.positions[vi * 3 + 1])
      loZ = Math.min(loZ, mesh.positions[vi * 3 + 2])
      hiZ = Math.max(hiZ, mesh.positions[vi * 3 + 2])
    }
    const [x0, x1] = cellRange(loX, hiX, 0)
    const [y0, y1] = cellRange(loY, hiY, 1)
    const [z0, z1] = cellRange(loZ, hiZ, 2)
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          bins[voxelIndex(size, x, y, z)].push(t)
        }
      }
    }
  }

  for (let idx = 0; idx < occupancy.length; idx++) {
    if (occupancy[idx] !== 1) continue
    const candidates = bins[idx]
    if (candidates.length === 0) continue
    let r = 0
    let g = 0
    let b = 0
    for (const t of candidates) {
      const ia = mesh.indices[t * 3]
      const ib = mesh.indices[t * 3 + 1]
      const ic = mesh.indices[t * 3 + 2]
      r += mesh.colors[ia * 3] + mesh.colors[ib * 3] + mesh.colors[ic * 3]
      g += mesh.colors[ia * 3 + 1] + mesh.colors[ib * 3 + 1] + mesh.colors[ic * 3 + 1]
      b += mesh.colors[ia * 3 + 2] + mesh.colors[ib * 3 + 2] + mesh.colors[ic * 3 + 2]
    }
    const hits = candidates.length * 3
    sampleRGB[idx * 3] = Math.round(r / hits)
    sampleRGB[idx * 3 + 1] = Math.round(g / hits)
    sampleRGB[idx * 3 + 2] = Math.round(b / hits)
    if (idx % 20000 === 0) onProgress?.(0.5 + 0.5 * (idx / occupancy.length))
  }
}
