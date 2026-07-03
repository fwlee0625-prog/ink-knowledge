import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useState } from "react";
import { AppButton, Card, SegmentedControl, Toggle } from "../../ui";
import { clampNumber } from "../../../lib/format";
import type { AppSettings, BackendStatus, ExtensionInfo, OcrEngine } from "../../../types";

type SettingsSection = "general" | "recognition" | "extensions" | "backend";

type SettingsPageProps = {
  busy: boolean;
  extensions: ExtensionInfo[];
  log: string;
  settings: AppSettings;
  status: BackendStatus | null;
  onCheckBackend: () => Promise<void>;
  onChooseOutputDir: () => Promise<void>;
  onInstallExtension: () => Promise<void>;
  onResetSettings: () => Promise<void>;
  onSaveSettings: () => void;
  onUninstallExtension: (id: string, name: string) => Promise<void>;
  onUpdateSettings: Dispatch<SetStateAction<AppSettings>>;
};

const engineOptions: Array<{ label: string; value: OcrEngine }> = [
  { label: "Apple Vision", value: "apple-vision" },
  { label: "PaddleOCR 扩展", value: "paddle" },
];

const sections: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: "general", label: "基础设置", description: "输出目录和文件格式" },
  { id: "recognition", label: "识别参数", description: "引擎、语言和 PDF 行为" },
  { id: "extensions", label: "扩展管理", description: "导入和卸载 OCR 扩展" },
  { id: "backend", label: "后端状态", description: "检查内置后端和数据目录" },
];

export function SettingsPage({
  busy,
  extensions,
  log,
  settings,
  status,
  onCheckBackend,
  onChooseOutputDir,
  onInstallExtension,
  onResetSettings,
  onSaveSettings,
  onUninstallExtension,
  onUpdateSettings,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  return (
    <Card className="settings-panel settings-layout" variant="page">
      <aside className="settings-sidebar" aria-label="设置分类">
        {sections.map((section) => (
          <button
            className={activeSection === section.id ? "settings-nav-button active" : "settings-nav-button"}
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            type="button"
          >
            <strong>{section.label}</strong>
            <span>{section.description}</span>
          </button>
        ))}
      </aside>

      <div className="settings-content">
        {activeSection === "general" && (
          <section className="settings-section">
            <div className="section-title">
              <h2>基础设置</h2>
              <span>管理默认存储位置和输出文件格式。</span>
            </div>

            <div className="settings-list">
              <SettingRow description="默认输出识别结果的位置。" label="存储目录">
                <div className="file-row">
                  <input
                    onChange={(event) => onUpdateSettings((current) => ({ ...current, outputDir: event.target.value }))}
                    placeholder="默认在文稿目录下创建 墨识 OCR"
                    value={settings.outputDir}
                  />
                  <AppButton onClick={onChooseOutputDir}>选择</AppButton>
                </div>
              </SettingRow>

              <SettingRow description="至少保留一种输出格式。" label="输出格式">
                <div className="check-row">
                  <Toggle
                    checked={settings.outputTxt}
                    disabled={settings.outputTxt && !settings.outputJson}
                    onChange={(event) =>
                      onUpdateSettings((current) => ({
                        ...current,
                        outputTxt: event.target.checked || !current.outputJson,
                      }))
                    }
                  >
                    TXT
                  </Toggle>
                  <Toggle
                    checked={settings.outputJson}
                    disabled={settings.outputJson && !settings.outputTxt}
                    onChange={(event) =>
                      onUpdateSettings((current) => ({
                        ...current,
                        outputJson: event.target.checked || !current.outputTxt,
                      }))
                    }
                  >
                    JSON
                  </Toggle>
                </div>
              </SettingRow>
            </div>

            <SettingsActions busy={busy} onResetSettings={onResetSettings} onSaveSettings={onSaveSettings} />
          </section>
        )}

        {activeSection === "recognition" && (
          <section className="settings-section">
            <div className="section-title">
              <h2>识别参数</h2>
              <span>选择 OCR 引擎，调整 PDF 渲染和批量扫描行为。</span>
            </div>

            <div className="settings-list">
              <SettingRow description="Apple Vision 内置可用，PaddleOCR 需先安装扩展。" label="识别引擎">
                <SegmentedControl
                  disabled={busy}
                  onChange={(ocrEngine) => onUpdateSettings((current) => ({ ...current, ocrEngine }))}
                  options={engineOptions}
                  value={settings.ocrEngine}
                />
              </SettingRow>

              <SettingRow description="用于 PDF 扫描页渲染，数值越高越清晰也越慢。" label="DPI">
                <input
                  max="600"
                  min="72"
                  onChange={(event) =>
                    onUpdateSettings((current) => ({ ...current, dpi: Number(event.target.value || 300) }))
                  }
                  type="number"
                  value={settings.dpi}
                />
              </SettingRow>

              <SettingRow description="支持 ch、en、zh-Hans、zh-Hant 等语言代码。" label="语言">
                <input
                  onChange={(event) => onUpdateSettings((current) => ({ ...current, lang: event.target.value }))}
                  value={settings.lang}
                />
              </SettingRow>

              <SettingRow description="批量选择文件夹时向下扫描的目录层级。" label="文件夹递归层级">
                <input
                  max="5"
                  min="1"
                  onChange={(event) =>
                    onUpdateSettings((current) => ({
                      ...current,
                      recursionDepth: clampNumber(Number(event.target.value || 1), 1, 5),
                    }))
                  }
                  type="number"
                  value={settings.recursionDepth}
                />
              </SettingRow>

              <SettingRow description="忽略 PDF 自带文本层，逐页渲染后重新识别。" label="强制 OCR PDF 文本层">
                <Toggle
                  checked={settings.forceOcr}
                  onChange={(event) => onUpdateSettings((current) => ({ ...current, forceOcr: event.target.checked }))}
                >
                  启用
                </Toggle>
              </SettingRow>
            </div>

            <SettingsActions busy={busy} onResetSettings={onResetSettings} onSaveSettings={onSaveSettings} />
          </section>
        )}

        {activeSection === "extensions" && (
          <section className="settings-section">
            <div className="section-head">
              <div>
                <strong>OCR 扩展</strong>
                <span>导入包含 manifest.json 的本地扩展目录。</span>
              </div>
              <AppButton disabled={busy} onClick={onInstallExtension} variant="primary">
                导入扩展
              </AppButton>
            </div>

            <div className="extension-list">
              {extensions.map((extension) => (
                <article
                  className={extension.installed ? "extension-card installed" : "extension-card"}
                  key={extension.id}
                >
                  <div>
                    <strong>{extension.name}</strong>
                    <span>{extension.installed ? `版本 ${extension.version ?? "-"}` : extension.message}</span>
                    {extension.entry && <small>{extension.entry}</small>}
                  </div>
                  {extension.installed ? (
                    <AppButton
                      disabled={busy}
                      onClick={() => onUninstallExtension(extension.id, extension.name)}
                      variant="text"
                    >
                      卸载
                    </AppButton>
                  ) : (
                    <AppButton disabled={busy} onClick={onInstallExtension} variant="primary">
                      导入
                    </AppButton>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {activeSection === "backend" && (
          <section className="settings-section">
            <div className={status?.ready ? "ready status" : "pending status"}>
              <div>
                <strong>{status?.ready ? "OCR 后端已就绪" : "OCR 后端未就绪"}</strong>
                <span>{status?.message ?? "点击检查后端状态"}</span>
              </div>
              <div className="button-row">
                <AppButton disabled={busy} onClick={onCheckBackend} variant="primary">
                  检查后端
                </AppButton>
              </div>
            </div>

            <div className="backend-meta">
              <div>
                <span>内置后端命令</span>
                <strong>{status?.backend_bin ?? "-"}</strong>
              </div>
              <div>
                <span>App 数据目录</span>
                <strong>{status?.app_data_dir ?? "-"}</strong>
              </div>
            </div>

            <pre className="log-box">{log || "等待操作。"}</pre>
          </section>
        )}
      </div>
    </Card>
  );
}

function SettingsActions({
  busy,
  onResetSettings,
  onSaveSettings,
}: {
  busy: boolean;
  onResetSettings: () => Promise<void>;
  onSaveSettings: () => void;
}) {
  return (
    <div className="button-row settings-actions">
      <AppButton disabled={busy} onClick={onSaveSettings} variant="primary">
        保存设置
      </AppButton>
      <AppButton disabled={busy} onClick={onResetSettings}>
        恢复默认
      </AppButton>
    </div>
  );
}

function SettingRow({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
