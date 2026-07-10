import { FileText, Folder, Image, Plus, Upload } from "lucide-react";
import { AppButton } from "../../ui";
import { useOcrFileDrop } from "./useOcrFileDrop";

type OcrFileInputPanelProps = {
  busy: boolean;
  onChooseFolder: () => Promise<void>;
  onChooseImage: () => Promise<void>;
  onChoosePdf: () => Promise<void>;
  onDropPaths: (paths: string[]) => void | Promise<void>;
};

export function OcrFileInputPanel({
  busy,
  onChooseFolder,
  onChooseImage,
  onChoosePdf,
  onDropPaths,
}: OcrFileInputPanelProps) {
  const { dropActive, dropZoneProps } = useOcrFileDrop({
    disabled: busy,
    onDropPaths,
  });

  return (
    <section className="ocr-add-section">
      <h2>添加文件</h2>
      <div className="ocr-add-actions">
        <AppButton className="ocr-add-button" disabled={busy} onClick={onChooseImage} variant="ghost">
          <Plus />
          <Image />
          <span>图片</span>
        </AppButton>
        <AppButton className="ocr-add-button" disabled={busy} onClick={onChoosePdf} variant="ghost">
          <Plus />
          <FileText />
          <span>PDF</span>
        </AppButton>
        <AppButton className="ocr-add-button" disabled={busy} onClick={onChooseFolder} variant="ghost">
          <Plus />
          <Folder />
          <span>文件夹</span>
        </AppButton>
      </div>

      <button
        className={dropActive ? "ocr-drop-zone active" : "ocr-drop-zone"}
        disabled={busy}
        onClick={onChooseImage}
        type="button"
        {...dropZoneProps}
      >
        <Upload />
        <strong>拖拽文件到这里</strong>
        <span>支持 PNG、JPG、PDF、HEIC 等格式</span>
      </button>
    </section>
  );
}
