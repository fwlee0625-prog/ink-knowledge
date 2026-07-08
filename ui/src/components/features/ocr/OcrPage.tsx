import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { AppButton, Card, EmptyState } from "../../ui";
import { fileName, ocrButtonLabel } from "../../../lib/format";
import type { RecognitionFile, RecognitionProgress, ResultPreview } from "../../../types";

type OcrPageProps = {
  busy: boolean;
  progress: RecognitionProgress;
  recognizedFiles: RecognitionFile[];
  selectedFiles: string[];
  onClearFiles: () => void;
  onChooseFile: () => Promise<void>;
  onChooseFolder: () => Promise<void>;
  onRemoveFile: (path: string) => void;
  onRunOcr: () => Promise<void>;
};

export function OcrPage({
  busy,
  progress,
  recognizedFiles,
  selectedFiles,
  onChooseFile,
  onChooseFolder,
  onClearFiles,
  onRemoveFile,
  onRunOcr,
}: OcrPageProps) {
  const [activeResultPath, setActiveResultPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResultPreview | null>(null);
  const [previewError, setPreviewError] = useState("");

  const activeResult = useMemo(
    () => recognizedFiles.find((file) => file.outputPath === activeResultPath) ?? null,
    [activeResultPath, recognizedFiles],
  );

  useEffect(() => {
    if (!activeResultPath) {
      return;
    }

    if (!recognizedFiles.some((file) => file.outputPath === activeResultPath)) {
      setActiveResultPath(null);
      setPreview(null);
      setPreviewError("");
    }
  }, [activeResultPath, recognizedFiles]);

  useEffect(() => {
    if (!activeResultPath) {
      setPreview(null);
      setPreviewError("");
      return;
    }

    let cancelled = false;
    setPreview(null);
    setPreviewError("");
    invoke<ResultPreview>("preview_result_file", { request: { path: activeResultPath } })
      .then((nextPreview) => {
        if (!cancelled) {
          setPreview(nextPreview);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeResultPath]);

  const openResultFile = async (path: string) => {
    try {
      await invoke("open_result_file", { request: { path } });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  };

  const revealResultFile = async (path: string) => {
    try {
      await invoke("reveal_result_file", { request: { path } });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  };

  const closePreview = () => {
    setActiveResultPath(null);
    setPreview(null);
    setPreviewError("");
  };

  return (
    <section className={activeResultPath ? "workspace main-workspace with-result-preview" : "workspace main-workspace"}>
      <Card className="panel">
        <div className="field">
          <span>文件</span>
          <div className="picker-actions">
            <AppButton id="chooseFile" onClick={onChooseFile} variant="file">
              选择图片或 PDF
            </AppButton>
            <AppButton id="chooseFolder" onClick={onChooseFolder} variant="file">
              选择文件夹
            </AppButton>
          </div>
        </div>

        <AppButton disabled={busy} id="runOcr" onClick={onRunOcr} variant="primary">
          {ocrButtonLabel(busy, progress)}
        </AppButton>

        <SelectedFileList
          files={selectedFiles}
          onClear={onClearFiles}
          onRemoveFile={onRemoveFile}
          title={`已选择 ${selectedFiles.length} 个文件`}
        />
      </Card>

      <Card className="result">
        <div className="result-head">
          <div>
            <h2>识别文件</h2>
          </div>
          <span>{recognizedFiles.length > 0 ? `${recognizedFiles.length} 个文件` : "等待识别"}</span>
        </div>
        {recognizedFiles.length === 0 ? (
          <RecognizedFileList
            activePath={activeResultPath}
            files={recognizedFiles}
            onOpen={openResultFile}
            onPreview={setActiveResultPath}
            onReveal={revealResultFile}
          />
        ) : (
          <div className="result-body">
            <RecognizedFileList
              activePath={activeResultPath}
              files={recognizedFiles}
              onOpen={openResultFile}
              onPreview={setActiveResultPath}
              onReveal={revealResultFile}
            />
          </div>
        )}
      </Card>

      {activeResultPath && (
        <ResultPreviewPanel
          error={previewError}
          file={activeResult}
          onClose={closePreview}
          preview={preview}
        />
      )}
    </section>
  );
}

type SelectedFileListProps = {
  files: string[];
  onClear: () => void;
  onRemoveFile: (path: string) => void;
  title: string;
};

function SelectedFileList({ files, onClear, onRemoveFile, title }: SelectedFileListProps) {
  return (
    <div className="file-list-block">
      <div className="list-head">
        <strong>{title}</strong>
        {files.length > 0 && (
          <AppButton onClick={onClear} variant="text">
            清空
          </AppButton>
        )}
      </div>

      {files.length === 0 ? (
        <EmptyState>选择文件后会显示在这里。</EmptyState>
      ) : (
        <ul className="file-list">
          {files.map((path) => (
            <li key={path}>
              <div>
                <strong>{fileName(path)}</strong>
                <span>{path}</span>
              </div>
              <AppButton onClick={() => onRemoveFile(path)} variant="text">
                移除
              </AppButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type RecognizedFileListProps = {
  activePath: string | null;
  files: RecognitionFile[];
  onOpen: (path: string) => Promise<void>;
  onPreview: (path: string | null) => void;
  onReveal: (path: string) => Promise<void>;
};

function RecognizedFileList({ activePath, files, onOpen, onPreview, onReveal }: RecognizedFileListProps) {
  if (files.length === 0) {
    return <EmptyState variant="result">识别完成后的文件列表会显示在这里。</EmptyState>;
  }

  return (
    <ul className="recognized-list">
      {files.map((file, index) => (
        <li
          className={[file.status, file.outputPath === activePath ? "active" : ""].filter(Boolean).join(" ")}
          key={`${file.inputPath}-${file.path}-${index}`}
          onClick={() => {
            if (file.outputPath) {
              onPreview(file.outputPath);
            }
          }}
        >
          <div className="recognized-main">
            <strong>{file.name}</strong>
            {file.status === "error" && <small>{file.message}</small>}
          </div>
          <div className="recognized-actions">
            {file.status === "error" && <b>失败</b>}
            {file.outputPath && (
              <>
                <AppButton
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreview(file.outputPath);
                  }}
                  variant="text"
                >
                  预览
                </AppButton>
                <AppButton
                  onClick={(event) => {
                    event.stopPropagation();
                    void onOpen(file.outputPath as string);
                  }}
                  variant="text"
                >
                  打开
                </AppButton>
                <AppButton
                  onClick={(event) => {
                    event.stopPropagation();
                    void onReveal(file.outputPath as string);
                  }}
                  variant="text"
                >
                  定位
                </AppButton>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

type ResultPreviewPanelProps = {
  error: string;
  file: RecognitionFile | null;
  preview: ResultPreview | null;
  onClose: () => void;
};

function ResultPreviewPanel({ error, file, preview, onClose }: ResultPreviewPanelProps) {
  if (!file?.outputPath) {
    return <EmptyState>选择一条成功结果后预览内容。</EmptyState>;
  }

  const content = preview ? formatPreviewContent(preview) : "";

  return (
    <section className="result-preview">
      <div className="preview-head">
        <div>
          <strong>{preview?.name ?? fileName(file.outputPath)}</strong>
        </div>
        <button aria-label="关闭预览" className="preview-close-button" onClick={onClose} title="关闭预览" type="button">
          ×
        </button>
      </div>
      {error ? (
        <p className="preview-error">{error}</p>
      ) : (
        <>
          <pre className="preview-content">{content || "正在读取预览..."}</pre>
          {preview?.truncated && <p className="preview-note">文件较大，当前仅显示前 512 KB。</p>}
        </>
      )}
    </section>
  );
}

function formatPreviewContent(preview: ResultPreview) {
  if (preview.extension !== "json") {
    return preview.content;
  }

  try {
    return JSON.stringify(JSON.parse(preview.content), null, 2);
  } catch {
    return preview.content;
  }
}
