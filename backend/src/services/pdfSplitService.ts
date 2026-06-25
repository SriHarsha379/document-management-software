/**
 * pdfSplitService.ts
 *
 * Splits a multi-page PDF into individual JPEG page images.
 *
 * Runtime dependency: `pdftoppm` (part of poppler-utils).
 * On Debian/Ubuntu:  sudo apt-get install -y poppler-utils
 * On macOS:          brew install poppler
 *
 * When `pdftoppm` is unavailable the service throws a clear error so callers
 * can degrade gracefully and fall back to treating the PDF as a single unit.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

/** Maximum number of pages we will split per upload (configurable via env). */
export const MAX_PDF_PAGES = parseInt(process.env.MAX_PDF_PAGES ?? '20', 10);

export interface PdfPageFile {
  /** 1-based page number within the source PDF. */
  pageNumber: number;
  /** Absolute path to the extracted JPEG image file. */
  filePath: string;
  mimeType: 'image/jpeg';
}

/**
 * Returns the number of pages in the PDF at `filePath`.
 * Throws if the file cannot be parsed (e.g. encrypted, corrupt).
 */
export async function getPdfPageCount(filePath: string): Promise<number> {
  const buf = fs.readFileSync(filePath);
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: false });
    return doc.getPageCount();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read PDF: ${msg}`);
  }
}

/**
 * Splits every page of the PDF at `pdfFilePath` into a JPEG image saved in
 * `outputDir`.  Returns an array of {@link PdfPageFile} objects sorted by
 * page number.
 *
 * Throws when:
 * - `pdftoppm` is not installed / not on PATH.
 * - The page count exceeds {@link MAX_PDF_PAGES}.
 * - The PDF is encrypted or corrupt.
 */
export async function splitPdfToPageImages(
  pdfFilePath: string,
  outputDir: string,
): Promise<PdfPageFile[]> {
  const pageCount = await getPdfPageCount(pdfFilePath);

  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(
      `PDF has ${pageCount} pages which exceeds the maximum of ${MAX_PDF_PAGES}. ` +
        'Increase MAX_PDF_PAGES env variable to allow larger PDFs.',
    );
  }

  // Build a unique prefix so concurrent uploads don't collide.
  const prefix = path.join(outputDir, `pdfpage_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  // -jpeg  : output JPEG
  // -r 150 : 150 DPI (good balance of quality vs file size for OCR)
  // -aa yes: anti-alias text
  await execFileAsync('pdftoppm', ['-jpeg', '-r', '150', '-aa', 'yes', pdfFilePath, prefix]);

  // Discover files written by pdftoppm. They follow the pattern `<prefix>-<N>.jpg`
  // where <N> is zero-padded (e.g. -01, -001 for 10+ pages).
  const baseName = path.basename(prefix);
  const pageFiles = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith(baseName + '-') && f.endsWith('.jpg'))
    .sort() // lexicographic sort; zero-padding ensures correct order
    .map((filename, idx): PdfPageFile => ({
      pageNumber: idx + 1,
      filePath: path.join(outputDir, filename),
      mimeType: 'image/jpeg',
    }));

  if (pageFiles.length === 0) {
    throw new Error('pdftoppm produced no output files.');
  }

  return pageFiles;
}

/**
 * Convenience helper: returns `true` when `pdftoppm` can be found on PATH.
 * Used to fail fast with a meaningful error at startup rather than at upload
 * time in production.
 */
export async function isPdftoppmAvailable(): Promise<boolean> {
  try {
    await execFileAsync('pdftoppm', ['-v']);
    return true;
  } catch {
    return false;
  }
}
