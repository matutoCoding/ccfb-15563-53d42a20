import { voxelizeCpu } from './cpu_voxelizer'
import { isWebGpuSupported, voxelizeGpu } from './gpu_voxelizer'
import { propagateInteriorColors } from './cpu_voxelizer'
import type { VoxelMesh, VoxelVolume } from '../types'

export interface VoxelizeOptions {
  resolution: number
  shellThickness: number
  voxelMm: number
  forceCpu?: boolean
  onProgress?: (ratio: number, label: string) => void
}

export interface VoxelizeOutcome {
  volume: VoxelVolume
  engine: 'webgpu' | 'cpu'
  fellBack: boolean
}

/**
 * 体素化统一入口：默认 WebGPU compute，失败/不支持时透明降级到 CPU
 * 两条路径共享 SAT 重叠测试与同一套后处理（填充、掏空、统计）
 */
export const runVoxelize = async (
  mesh: VoxelMesh,
  options: VoxelizeOptions,
): Promise<VoxelizeOutcome> => {
  const useGpu = !options.forceCpu && isWebGpuSupported()
  if (useGpu) {
    try {
      const volume = await voxelizeGpu(mesh, {
        resolution: options.resolution,
        shellThickness: options.shellThickness,
        voxelMm: options.voxelMm,
        onProgress: (r) => options.onProgress?.(r, 'WebGPU 体素化'),
      })
      propagateInteriorColors(volume)
      return { volume, engine: 'webgpu', fellBack: false }
    } catch (err) {
      console.warn('[voxel] WebGPU 路径失败，降级 CPU：', err)
    }
  }
  const volume = voxelizeCpu(mesh, {
    resolution: options.resolution,
    shellThickness: options.shellThickness,
    voxelMm: options.voxelMm,
    onProgress: (r) => options.onProgress?.(r, 'CPU 体素化'),
  })
  propagateInteriorColors(volume)
  return { volume, engine: 'cpu', fellBack: useGpu }
}
