import { invoke } from "@tauri-apps/api/core";
import { Check, File as GenericFileIcon, FileImage, Play, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AppButton, AppSelect, Card, EmptyState, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui";
import { fileName, formatBytes, ocrButtonLabel } from "../../../lib/format";
import type { AppSettings, FileInfo, OcrEngine, RecognitionFile, RecognitionProgress, ResultPreview } from "../../../types";
import { OcrFileInputPanel } from "./OcrFileInputPanel";
import { getOcrFileKind, type OcrFileKind } from "./ocrFileSupport";

type OcrPageProps = {
  busy: boolean;
  progress: RecognitionProgress;
  recognizedFiles: RecognitionFile[];
  selectedFiles: string[];
  settings: AppSettings;
  onAddDroppedFiles: (paths: string[]) => void | Promise<void>;
  onClearFiles: () => void;
  onChooseFiles: () => Promise<void>;
  onChooseFolder: () => Promise<void>;
  onRemoveFile: (path: string) => void;
  onRunOcr: () => Promise<void>;
  onUpdateSettings: (updater: (current: AppSettings) => AppSettings) => void;
};

type OutputFormat = "txt" | "json";

const engineOptions: Array<{ label: string; value: OcrEngine }> = [
  { label: "Apple Vision（推荐）", value: "apple-vision" },
  { label: "PaddleOCR 扩展", value: "paddle" },
];

export function OcrPage({
  busy,
  progress,
  recognizedFiles,
  selectedFiles,
  settings,
  onAddDroppedFiles,
  onChooseFiles,
  onChooseFolder,
  onClearFiles,
  onRemoveFile,
  onRunOcr,
  onUpdateSettings,
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

  const updateOutputFormat = (format: OutputFormat, checked: boolean) => {
    onUpdateSettings((current) => {
      if (format === "txt") {
        return { ...current, outputTxt: checked || !current.outputJson };
      }
      return { ...current, outputJson: checked || !current.outputTxt };
    });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <section className={activeResultPath ? "workspace main-workspace with-result-preview" : "workspace main-workspace"}>
        <Card className="panel ocr-input-panel">
          <OcrFileInputPanel
            busy={busy}
            onChooseFolder={onChooseFolder}
            onChooseFiles={onChooseFiles}
            onDropPaths={onAddDroppedFiles}
          />

          <SelectedFileList
            files={selectedFiles}
            onClear={onClearFiles}
            onRemoveFile={onRemoveFile}
            title={`已选择 ${selectedFiles.length} 个文件`}
          />

          <section className="ocr-config-section">
            <h2>OCR 配置</h2>
            <div className="ocr-config-field">
              <label>识别引擎</label>
              <AppSelect
                ariaLabel="识别引擎"
                className="ocr-engine-select"
                disabled={busy}
                onChange={(ocrEngine) => onUpdateSettings((current) => ({ ...current, ocrEngine }))}
                options={engineOptions}
                value={settings.ocrEngine}
              />
            </div>

            <div className="ocr-config-field">
              <span>输出格式</span>
              <div className="ocr-format-row">
                <OutputFormatToggle
                  checked={settings.outputTxt}
                  disabled={settings.outputTxt && !settings.outputJson}
                  label="TXT"
                  onChange={(checked) => updateOutputFormat("txt", checked)}
                />
                <OutputFormatToggle
                  checked={settings.outputJson}
                  disabled={settings.outputJson && !settings.outputTxt}
                  label="JSON"
                  onChange={(checked) => updateOutputFormat("json", checked)}
                />
              </div>
            </div>
          </section>

          <AppButton className="ocr-run-button" disabled={busy} id="runOcr" onClick={onRunOcr} variant="primary">
            <Play />
            {ocrButtonLabel(busy, progress)}
          </AppButton>
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
    </TooltipProvider>
  );
}

type SelectedFileListProps = {
  files: string[];
  onClear: () => void;
  onRemoveFile: (path: string) => void;
  title: string;
};

function SelectedFileList({ files, onClear, onRemoveFile, title }: SelectedFileListProps) {
  const [fileInfoByPath, setFileInfoByPath] = useState<Record<string, FileInfo>>({});

  useEffect(() => {
    let cancelled = false;

    if (files.length === 0) {
      setFileInfoByPath({});
      return;
    }

    Promise.all(
      files.map((path) =>
        invoke<FileInfo>("get_file_info", { request: { path } })
          .then((info) => [path, info] as const)
          .catch(() => [path, { path, name: fileName(path), size: 0 }] as const),
      ),
    ).then((entries) => {
      if (!cancelled) {
        setFileInfoByPath(Object.fromEntries(entries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [files]);

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
              <SelectedFileTooltip info={fileInfoByPath[path]} path={path}>
                <div className="selected-file-main">
                  <SelectedFileIcon kind={getOcrFileKind(path)} />
                  <strong className="file-name-ellipsis">{fileInfoByPath[path]?.name ?? fileName(path)}</strong>
                </div>
              </SelectedFileTooltip>
              <button aria-label={`移除 ${fileName(path)}`} className="file-remove-button" onClick={() => onRemoveFile(path)} type="button">
                <X />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectedFileTooltip({ children, info, path }: { children: ReactNode; info?: FileInfo; path: string }) {
  const name = info?.name ?? fileName(path);
  const size = info ? formatBytes(info.size) : "读取中...";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent align="start" className="selected-file-tooltip" side="top">
        <dl>
          <div>
            <dt>名称</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>路径</dt>
            <dd>{path}</dd>
          </div>
          <div>
            <dt>大小</dt>
            <dd>{size}</dd>
          </div>
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}

function SelectedFileIcon({ kind }: { kind: OcrFileKind }) {
  const label = kind === "image" ? "图片文件" : kind === "pdf" ? "PDF 文件" : "文件";

  if (kind === "pdf") {
    return (
      <span aria-label={label} className="selected-file-icon pdf" title={label}>
        <PdfFileIcon />
      </span>
    );
  }

  const Icon = kind === "image" ? FileImage : GenericFileIcon;
  return (
    <span aria-label={label} className={`selected-file-icon ${kind}`} title={label}>
      <Icon />
    </span>
  );
}

function PdfFileIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8.4L20 7.6V20a2 2 0 0 1-2 2H6Z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <text x="12" y="17.2" textAnchor="middle">
        PDF
      </text>
    </svg>
  );
}

function OutputFormatToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={checked ? "ocr-format-toggle checked" : "ocr-format-toggle"}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{checked && <Check />}</span>
      <strong>{label}</strong>
    </label>
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
            <FileNameTooltip name={file.name} />
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
          <FileNameTooltip name={preview?.name ?? fileName(file.outputPath)} />
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

function FileNameTooltip({ name }: { name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <strong className="file-name-ellipsis">{name}</strong>
      </TooltipTrigger>
      <TooltipContent align="start" className="max-w-[min(560px,80vw)] break-all leading-relaxed" side="top">
        {name}
      </TooltipContent>
    </Tooltip>
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
