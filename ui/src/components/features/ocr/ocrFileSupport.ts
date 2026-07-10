export const ocrImageExtensions = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "heic", "heif"];
export const ocrFileExtensions = ["pdf", ...ocrImageExtensions];

export type OcrFileKind = "image" | "pdf" | "file";

function getFileExtension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function getOcrFileKind(path: string): OcrFileKind {
  const extension = getFileExtension(path);
  if (extension === "pdf") {
    return "pdf";
  }
  if (ocrImageExtensions.includes(extension)) {
    return "image";
  }
  return "file";
}

export function isSupportedOcrFilePath(path: string) {
  const extension = getFileExtension(path);
  return Boolean(extension && ocrFileExtensions.includes(extension));
}
