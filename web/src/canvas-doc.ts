import { regular, bold, italic } from './fonts/pdf-fonts';
import { PDF_FONT } from './pdf-common';

/**
 * Receipts as pictures (PNG): the same drawing code as the PDF (receipt-pdf.ts) runs against this
 * stand-in for the few jsPDF commands it uses, which records them; render() then paints every page,
 * one under the other, on a canvas. Sizes are in millimetres like the PDF; fonts are the PDF's own.
 */
type Op = (ctx: CanvasRenderingContext2D) => void;
type Page = { w: number; h: number; ops: Op[] };
type Style = 'normal' | 'bold' | 'italic';
const PT = 25.4 / 72; // one point in millimetres

let fontsReady: Promise<void> | null = null;
const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
/** Load the receipt font for canvases (once). */
export function loadCanvasFonts() {
  fontsReady ??= Promise.all(
    (
      [
        [regular, { weight: '400', style: 'normal' }],
        [bold, { weight: '700', style: 'normal' }],
        [italic, { weight: '400', style: 'italic' }],
      ] as const
    ).map(async ([data, desc]) => {
      const face = new FontFace(PDF_FONT, bytes(data), desc);
      await face.load();
      document.fonts.add(face);
    }),
  ).then(() => undefined);
  return fontsReady;
}

/** Load images (data URLs) so their sizes are known while drawing. */
export async function loadImages(sources: string[]) {
  const map = new Map<string, HTMLImageElement>();
  await Promise.all(
    sources.filter(Boolean).map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            map.set(src, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
  return map;
}

export class CanvasDoc {
  private pages: Page[] = [];
  private page = 0;
  private size = 10;
  private style: Style = 'normal';
  private text_: string = 'rgb(0,0,0)';
  private fill_: string = 'rgb(0,0,0)';
  private draw_: string = 'rgb(0,0,0)';
  private width_ = 0.2;
  private dash: number[] = [];
  private alpha = 1;
  private measure: CanvasRenderingContext2D;

  constructor(
    format: [number, number],
    private images: Map<string, HTMLImageElement>,
  ) {
    this.pages.push({ w: format[0], h: format[1], ops: [] });
    const c = document.createElement('canvas');
    this.measure = c.getContext('2d')!;
  }
  private font(scale = 1) {
    const px = this.size * PT * scale;
    return `${this.style === 'italic' ? 'italic ' : ''}${this.style === 'bold' ? '700 ' : '400 '}${px}px ${PDF_FONT}`;
  }
  private push(op: Op) {
    this.pages[this.page].ops.push(op);
  }
  private colour(args: (number | string)[]) {
    if (typeof args[0] === 'string') return args[0];
    const [r, g = r, b = r] = args as number[];
    return `rgb(${r},${g},${b})`;
  }
  addFileToVFS() {}
  addFont() {}
  setFont(_name: string, style: Style = 'normal') {
    this.style = style;
  }
  setFontSize(size: number) {
    this.size = size;
  }
  setTextColor(...args: (number | string)[]) {
    this.text_ = this.colour(args);
  }
  setFillColor(...args: (number | string)[]) {
    this.fill_ = this.colour(args);
  }
  setDrawColor(...args: (number | string)[]) {
    this.draw_ = this.colour(args);
  }
  setLineWidth(width: number) {
    this.width_ = width;
  }
  setLineDashPattern(pattern: number[]) {
    this.dash = [...pattern];
  }
  setGState(state: { opacity?: number }) {
    this.alpha = state?.opacity ?? 1;
  }
  /** Width of text in millimetres at the current font. */
  getTextWidth(text: string) {
    this.measure.font = this.font();
    return this.measure.measureText(text).width;
  }
  splitTextToSize(text: string, width: number) {
    const out: string[] = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const next = line + word;
        if (line && this.getTextWidth(next.trimEnd()) > width && word.trim()) {
          out.push(line.trimEnd());
          line = word.trimStart();
          // A single word longer than the line: break it.
          while (this.getTextWidth(line) > width && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && this.getTextWidth(line.slice(0, cut)) > width) cut--;
            out.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        } else line = next;
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  text(text: string | string[], x: number, y: number, options: { align?: 'left' | 'right' | 'center' } = {}) {
    const lines = Array.isArray(text) ? text : [text];
    const font = this.font(),
      colour = this.text_,
      alpha = this.alpha,
      align = options.align ?? 'left',
      step = this.size * PT * 1.15;
    this.push((ctx) => {
      ctx.globalAlpha = alpha;
      ctx.font = font;
      ctx.fillStyle = colour;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      lines.forEach((line, i) => ctx.fillText(line, x, y + i * step));
    });
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number) {
    const colour = this.draw_,
      width = this.width_,
      dash = this.dash,
      alpha = this.alpha;
    this.push((ctx) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    return this;
  }
  rect(x: number, y: number, w: number, h: number, style = 'S') {
    const fill = this.fill_,
      stroke = this.draw_,
      width = this.width_,
      alpha = this.alpha;
    this.push((ctx) => {
      ctx.globalAlpha = alpha;
      if (style.includes('F')) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
      }
      if (style.includes('D') || style === 'S') {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.strokeRect(x, y, w, h);
      }
    });
    return this;
  }
  getImageProperties(data: string) {
    const img = this.images.get(data);
    if (!img) throw Error('Image not loaded');
    return { fileType: 'PNG', width: img.naturalWidth, height: img.naturalHeight };
  }
  addImage(data: string, _type: string, x: number, y: number, w: number, h: number) {
    const img = this.images.get(data);
    if (!img) return this;
    const alpha = this.alpha;
    this.push((ctx) => {
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, x, y, w, h);
    });
    return this;
  }
  addPage(format?: [number, number]) {
    const last = this.pages[this.pages.length - 1];
    this.pages.push({ w: format?.[0] ?? last.w, h: format?.[1] ?? last.h, ops: [] });
    this.page = this.pages.length - 1;
    return this;
  }
  getNumberOfPages() {
    return this.pages.length;
  }
  setPage(n: number) {
    this.page = Math.max(0, Math.min(this.pages.length - 1, n - 1));
    return this;
  }
  /** Paint every page, one under the other, `pxPerMm` pixels per millimetre, on white. */
  render(pxPerMm: number) {
    const width = Math.max(...this.pages.map((p) => p.w));
    const height = this.pages.reduce((n, p) => n + p.h, 0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pxPerMm);
    canvas.height = Math.round(height * pxPerMm);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let top = 0;
    for (const page of this.pages) {
      ctx.save();
      ctx.scale(pxPerMm, pxPerMm);
      ctx.translate(0, top);
      for (const op of page.ops) op(ctx);
      ctx.restore();
      top += page.h;
    }
    return canvas;
  }
}

/** A canvas as a PNG file. */
export const canvasPng = (canvas: HTMLCanvasElement, name: string) =>
  new Promise<File>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(Error('Could not make the picture.'))),
      'image/png',
    ),
  );
