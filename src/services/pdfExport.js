import { buildScenarioReportHtml } from './export.js';

export const A4_PORTRAIT_PT = Object.freeze({ width: 595.28, height: 841.89 });

const PAGE_WIDTH_PX = 794;
const PAGE_HEIGHT_PX = 1123;
const PAGE_MARGIN_PX = 18;
const RENDER_SCALE = 2;

function encodeAscii(value) {
  return new TextEncoder().encode(String(value));
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

/**
 * يبني ملف PDF بسيطًا وصحيحًا من صفحات JPEG جاهزة.
 * إبقاء هذه الطبقة صغيرة ومحلية يمنع تحميل مكتبة PDF ثقيلة في تطبيق GitHub Pages.
 */
export function buildPdfFromJpegPages(pages = []) {
  if (!pages.length) throw new Error('لا توجد صفحات لإنشاء ملف PDF.');

  const objectCount = 2 + (pages.length * 3);
  const objects = new Array(objectCount + 1);
  const pageRefs = [];

  pages.forEach((page, index) => {
    const pageObject = 3 + (index * 3);
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    pageRefs.push(`${pageObject} 0 R`);

    const content = `q\n${A4_PORTRAIT_PT.width} 0 0 ${A4_PORTRAIT_PT.height} 0 0 cm\n/Im${index} Do\nQ\n`;
    const contentBytes = encodeAscii(content);

    objects[pageObject] = encodeAscii(
      `${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_PORTRAIT_PT.width} ${A4_PORTRAIT_PT.height}] /Resources << /XObject << /Im${index} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`,
    );

    objects[imageObject] = concatBytes([
      encodeAscii(
        `${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      ),
      page.bytes,
      encodeAscii('\nendstream\nendobj\n'),
    ]);

    objects[contentObject] = concatBytes([
      encodeAscii(`${contentObject} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      encodeAscii('endstream\nendobj\n'),
    ]);
  });

  objects[1] = encodeAscii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects[2] = encodeAscii(
    `2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${pageRefs.join(' ')}] >>\nendobj\n`,
  );

  const parts = [concatBytes([
    encodeAscii('%PDF-1.4\n%'),
    new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]),
    encodeAscii('\n'),
  ])];
  const offsets = new Array(objectCount + 1).fill(0);
  let cursor = parts[0].length;

  for (let index = 1; index <= objectCount; index += 1) {
    offsets[index] = cursor;
    parts.push(objects[index]);
    cursor += objects[index].length;
  }

  const xrefOffset = cursor;
  const xrefRows = ['0000000000 65535 f '];
  for (let index = 1; index <= objectCount; index += 1) {
    xrefRows.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
  }

  parts.push(encodeAscii(
    `xref\n0 ${objectCount + 1}\n${xrefRows.join('\n')}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ));

  return concatBytes(parts);
}

function safeFilePart(value = '') {
  const cleaned = String(value)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'خطة الأنصبة';
}

function reportStatus(options = {}) {
  if (options.status) return options.status;
  if (options.approved) return 'معتمدة';
  if (options.isDraft) return 'مسودة';
  return 'مقترح';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function waitForFrame(frame) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('تأخر تجهيز التقرير للطباعة.')), 10000);
    frame.addEventListener('load', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function waitForImage(image) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('تأخر تحويل التقرير إلى صورة PDF.')), 8000);
    image.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('تعذر تحويل التقرير إلى صورة PDF.'));
    };
  });
}

function canvasToJpegBytes(canvas, quality = 0.93) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('تعذر تجهيز صفحة PDF.'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', quality);
  });
}

function pageCanvasesFromReport(sourceCanvas) {
  const targetWidth = PAGE_WIDTH_PX * RENDER_SCALE;
  const targetHeight = PAGE_HEIGHT_PX * RENDER_SCALE;
  const page = document.createElement('canvas');
  page.width = targetWidth;
  page.height = targetHeight;

  const context = page.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, page.width, page.height);

  const padding = PAGE_MARGIN_PX * RENDER_SCALE;
  const usableWidth = targetWidth - (padding * 2);
  const usableHeight = targetHeight - (padding * 2);
  const fitScale = Math.min(usableWidth / sourceCanvas.width, usableHeight / sourceCanvas.height);
  const drawWidth = sourceCanvas.width * fitScale;
  const drawHeight = sourceCanvas.height * fitScale;
  const drawX = Math.round((targetWidth - drawWidth) / 2);
  const drawY = padding;

  context.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight);
  return [page];
}

async function renderReportCanvas(html) {
  if (!globalThis.document?.body || typeof document.createElement !== 'function') {
    throw new Error('تصدير PDF المباشر متاح من داخل المتصفح فقط.');
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'تجهيز تقرير قِسطاس PDF');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    width: `${PAGE_WIDTH_PX}px`,
    height: '1px',
    border: '0',
    left: '-20000px',
    top: '0',
    opacity: '0',
    pointerEvents: 'none',
  });

  document.body.appendChild(frame);
  const loaded = waitForFrame(frame);
  frame.srcdoc = html;

  try {
    await loaded;
    const reportDocument = frame.contentDocument;
    if (!reportDocument) throw new Error('تعذر فتح قالب التقرير.');

    const override = reportDocument.createElement('style');
    override.textContent = `
      html, body { margin: 0 !important; padding: 0 !important; width: ${PAGE_WIDTH_PX}px !important; min-height: 0 !important; background: #fff !important; overflow: visible !important; }
      body { padding: ${PAGE_MARGIN_PX}px !important; }
      .report { width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; background: #fff !important; }
    `;
    reportDocument.head.appendChild(override);

    try {
      await reportDocument.fonts?.ready;
    } catch {
      // الخطوط النظامية ستُستخدم عند غياب FontFaceSet.
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const report = reportDocument.querySelector('.report');
    if (!report) throw new Error('لم يتم العثور على محتوى التقرير.');
    const reportHeight = Math.max(
      PAGE_HEIGHT_PX,
      Math.ceil(report.getBoundingClientRect().height + (PAGE_MARGIN_PX * 2)),
    );

    const styleText = [...reportDocument.querySelectorAll('style')]
      .map((style) => style.textContent || '')
      .join('\n');
    const reportMarkup = report.outerHTML;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
      <svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH_PX}" height="${reportHeight}" viewBox="0 0 ${PAGE_WIDTH_PX} ${reportHeight}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" style="width:${PAGE_WIDTH_PX}px;min-height:${reportHeight}px;padding:${PAGE_MARGIN_PX}px;box-sizing:border-box;background:#fff;overflow:hidden;">
            <style>${styleText}</style>
            ${reportMarkup}
          </div>
        </foreignObject>
      </svg>`;

    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    image.decoding = 'async';
    const imageReady = waitForImage(image);
    image.src = svgUrl;
    await imageReady;

    const canvas = document.createElement('canvas');
    canvas.width = PAGE_WIDTH_PX * RENDER_SCALE;
    canvas.height = reportHeight * RENDER_SCALE;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    frame.remove();
  }
}

export async function createScenarioPdfBlob(scenario, data, options = {}) {
  const html = buildScenarioReportHtml(scenario, data, options);
  const reportCanvas = await renderReportCanvas(html);
  const pageCanvases = pageCanvasesFromReport(reportCanvas);
  const pages = [];

  for (const canvas of pageCanvases) {
    pages.push({
      width: canvas.width,
      height: canvas.height,
      bytes: await canvasToJpegBytes(canvas),
    });
  }

  return new Blob([buildPdfFromJpegPages(pages)], { type: 'application/pdf' });
}

export async function exportScenarioPdf(scenario, data, options = {}) {
  const blob = await createScenarioPdfBlob(scenario, data, options);
  const status = reportStatus(options);
  const department = safeFilePart(data.departmentName || data.planName || 'خطة الأنصبة');
  const filename = `قسطاس-${department}-${status}.pdf`;
  if (options.download !== false) downloadBlob(blob, filename);
  return { blob, filename };
}
