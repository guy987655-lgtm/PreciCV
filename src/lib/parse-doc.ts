import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export class ParseDocError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Server-side text extraction from an uploaded CV (PDF/DOCX). */
export async function extractDocText(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) {
    throw new ParseDocError("File too large (max 10MB)", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  let rawText = "";
  try {
    if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      rawText = text;
    } else if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value;
    } else {
      throw new ParseDocError(
        "Unsupported file type. Upload a PDF or DOCX.",
        400
      );
    }
  } catch (e) {
    if (e instanceof ParseDocError) throw e;
    throw new ParseDocError(
      "Could not read the document. Try exporting it again as PDF.",
      422
    );
  }

  if (rawText.trim().length < 100) {
    throw new ParseDocError(
      "We couldn't extract enough text from this file. If it's a scanned image, please upload a text-based PDF or DOCX.",
      422
    );
  }

  return rawText;
}
