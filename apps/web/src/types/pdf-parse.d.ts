declare module 'pdf-parse' {
  type PdfParseResult = {
    text?: string
    [key: string]: unknown
  }

  export default function pdfParse(dataBuffer: Buffer): Promise<PdfParseResult>
}
