import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Download, ExternalLink, Info, RefreshCw } from "lucide-react";
import changelogData from "../../../data/changelog.json";
import type { AppUpdateStatus, ChangelogEntry } from "../../../types";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "../../ui";

type AppUpdatePanelProps = {
  manualError: string;
  onCheckForUpdates: () => Promise<unknown>;
  status: AppUpdateStatus;
};

const changelog = [...(changelogData as ChangelogEntry[])].sort((left, right) =>
  right.version.localeCompare(left.version, undefined, { numeric: true }),
);
const updateAlertClassName =
  "flex min-h-[88px] items-center gap-3 py-4 [&>svg]:static [&>svg]:shrink-0 [&>svg+div]:translate-y-0 [&>svg~*]:pl-0";

export function AppUpdatePanel({ manualError, onCheckForUpdates, status }: AppUpdatePanelProps) {
  const checking = status.state === "checking";
  const updateAvailable = status.state === "update_available";
  const targetUrl = status.downloadUrl || status.releasePageUrl;
  const targetLabel = status.downloadUrl ? "下载 DMG" : "查看发布页";

  const openRelease = async () => {
    if (!targetUrl || !isTrustedUpdateUrl(targetUrl)) return;
    await openUrl(targetUrl);
  };

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden">
        <CardHeader className="gap-4 p-6 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <CardTitle>版本更新</CardTitle>
            <CardDescription>
              当前版本 {status.currentVersion || "-"}
              {status.latestVersion ? `，最新版本 ${status.latestVersion}` : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button disabled={checking} onClick={() => void onCheckForUpdates()} variant="outline">
              <RefreshCw className={checking ? "animate-spin" : undefined} />
              {checking ? "检查中" : "检查更新"}
            </Button>
            {updateAvailable && targetUrl && (
              <Button onClick={() => void openRelease()}>
                {status.downloadUrl ? <Download /> : <ExternalLink />}
                {targetLabel}
              </Button>
            )}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="space-y-5 p-6">
          {manualError ? (
            <Alert className={updateAlertClassName} variant="destructive">
              <Info />
              <AlertDescription>{manualError}</AlertDescription>
            </Alert>
          ) : updateAvailable ? (
            <Alert className={updateAlertClassName}>
              <Info />
              <AlertDescription>
                发现新版本 {status.latestVersion}
                {status.publishedAt ? `，发布于 ${formatPublishedAt(status.publishedAt)}` : ""}。
              </AlertDescription>
            </Alert>
          ) : status.state === "up_to_date" ? (
            <Alert className={updateAlertClassName}>
              <CheckCircle2 />
              <AlertDescription>当前已是最新版本。</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              {checking ? "正在检查最新正式版本。" : "尚未获取到最新版信息，可手动检查。"}
            </p>
          )}

          {updateAvailable && (status.releaseName || status.releaseNotes) && (
            <div className="space-y-3">
              {status.releaseName && <h3 className="text-base font-semibold text-foreground">{status.releaseName}</h3>}
              {status.releaseNotes && (
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                  {status.releaseNotes}
                </p>
              )}
            </div>
          )}

          {status.checkedAt && !checking && (
            <p className="text-xs text-muted-foreground">最后检查：{formatCheckedAt(status.checkedAt)}</p>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="p-6">
          <CardTitle>更新日志</CardTitle>
          <CardDescription>随应用内置的正式版本记录。</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="divide-y divide-border/60 p-0">
          {changelog.map((entry) => {
            const current = entry.version === status.currentVersion;
            return (
              <article className="grid gap-4 p-6 md:grid-cols-[140px_minmax(0,1fr)]" key={entry.version}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-foreground">v{entry.version}</strong>
                    {current && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">当前版本</span>
                    )}
                  </div>
                  <time className="mt-1 block text-xs text-muted-foreground">{entry.date}</time>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{entry.title}</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                    {entry.changes.map((change) => (
                      <li className="flex gap-2" key={change}>
                        <span aria-hidden="true" className="mt-[10px] size-1 shrink-0 rounded-full bg-muted-foreground" />
                        <span>{change}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function isTrustedUpdateUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function formatPublishedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function formatCheckedAt(value: string) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false })
    : value;
}
