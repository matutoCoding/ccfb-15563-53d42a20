import { downloadBlob } from '../math_utils'
import {
  deserializeOrderFile,
  serializeOrder,
} from '../project_codec'
import type { Order } from '../types'

export const exportOrderProject = (order: Order): void => {
  const payload = serializeOrder(order)
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  downloadBlob(blob, `${order.name.replace(/[\\/:*?"<>|]/g, '_')}_工程.json`)
}

export const importOrderProject = async (file: File): Promise<Order> => {
  const text = await file.text()
  return deserializeOrderFile(JSON.parse(text))
}
