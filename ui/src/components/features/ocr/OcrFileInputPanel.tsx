import { FilePlus, FolderPlus, Upload } from "lucide-react";
import { AppButton } from "../../ui";
import { useOcrFileDrop } from "./useOcrFileDrop";

type OcrFileInputPanelProps = {
  busy: boolean;
  onChooseFolder: () => Promise<void>;
  onChooseFiles: () => Promise<void>;
  onDropPaths: (paths: string[]) => void | Promise<void>;
};

export function OcrFileInputPanel({
  busy,
  onChooseFolder,
  onChooseFiles,
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
        <AppButton className="ocr-add-button" disabled={busy} onClick={onChooseFiles} variant="ghost">
          <FilePlus />
          <span>选择文件</span>
        </AppButton>
        <AppButton className="ocr-add-button" disabled={busy} onClick={onChooseFolder} variant="ghost">
          <FolderPlus />
          <span>文件夹</span>
        </AppButton>
      </div>

      <button
        className={dropActive ? "ocr-drop-zone active" : "ocr-drop-zone"}
        disabled={busy}
        onClick={onChooseFiles}
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
