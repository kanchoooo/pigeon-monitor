import { nativeImage, NativeImage } from 'electron'

// 트레이 아이콘: 왼쪽을 보는 비둘기 도트. 런타임에 비트맵으로 만든다.
// '#' = 몸, 'o' = 눈(빈칸), '+' = 옅은 부분(목·날개)
const PIGEON_16 = [
  '................',
  '................',
  '....##..........',
  '...####.........',
  '..#o###.........',
  '.######.........',
  '...#++##........',
  '...#+++####.....',
  '..##++#########.',
  '..#############.',
  '...###########..',
  '....#########...',
  '......####......',
  '......#..#......',
  '.....##.##......',
  '................'
]

function rasterize(rows: string[], scale: number, body: [number, number, number], light: [number, number, number], template: boolean): Buffer {
  const h = rows.length
  const w = rows[0].length
  const W = w * scale
  const H = h * scale
  const buf = Buffer.alloc(W * H * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x]
      if (c === '.' || c === 'o') continue
      const [r, g, b] = c === '#' ? body : light
      const a = template ? (c === '#' ? 255 : 170) : 255
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const i = ((y * scale + sy) * W + (x * scale + sx)) * 4
          // createFromBitmap 은 BGRA
          buf[i] = b
          buf[i + 1] = g
          buf[i + 2] = r
          buf[i + 3] = a
        }
      }
    }
  }
  return buf
}

export function trayIcon(): NativeImage {
  const isMac = process.platform === 'darwin'
  const body: [number, number, number] = isMac ? [0, 0, 0] : [122, 132, 152]
  const light: [number, number, number] = isMac ? [0, 0, 0] : [70, 170, 130]
  const img = nativeImage.createEmpty()
  img.addRepresentation({ scaleFactor: 1, width: 16, height: 16, buffer: rasterize(PIGEON_16, 1, body, light, isMac) })
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: rasterize(PIGEON_16, 2, body, light, isMac) })
  if (isMac) img.setTemplateImage(true)
  return img
}
