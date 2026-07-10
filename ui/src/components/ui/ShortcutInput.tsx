import { useEffect, useRef, useState } from "react";

import { Kbd, KbdGroup } from "./kbd";

type ShortcutInputProps = {
  /// 当前绑定的 Tauri Accelerator 字符串，例如 "Alt+Shift+O"。空字符串表示未绑定。
  value: string;
  /// 值变更回调；传入空字符串表示清除绑定。
  onChange: (value: string) => void;
  /// 占位符文本。
  placeholder?: string;
};

/// 快捷键捕获输入框。聚焦后监听键盘事件，组合键按下时写入 Tauri Accelerator 字符串。
/// - Escape：取消编辑，恢复原值。
/// - Backspace（无修饰键）：清除当前绑定。
/// - 修饰键单独按下：忽略，等待实际按键。
export function ShortcutInput({ value, onChange, placeholder = "点击后按下组合键" }: ShortcutInputProps) {
  const [listening, setListening] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listening) {
      setDraft(value);
    }
  }, [value, listening]);

  useEffect(() => {
    if (!listening) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setDraft(value);
        setListening(false);
        inputRef.current?.blur();
        return;
      }

      if (event.key === "Backspace" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        setDraft("");
        onChange("");
        setListening(false);
        inputRef.current?.blur();
        return;
      }

      // 修饰键单独按下时不提交，等用户继续按主键。
      if (isModifierKey(event.key)) {
        return;
      }

      const accelerator = buildAccelerator(event);
      if (!accelerator) return;
      setDraft(accelerator);
      onChange(accelerator);
      setListening(false);
      inputRef.current?.blur();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [listening, onChange, value]);

  return (
    <div
      className={listening ? "shortcut-input listening" : "shortcut-input"}
      onBlur={() => setListening(false)}
      onClick={() => {
        setDraft(value);
        setListening(true);
        inputRef.current?.focus();
      }}
      ref={inputRef}
      role="button"
      tabIndex={0}
    >
      {draft ? <ShortcutKeycaps accelerator={draft} /> : <span className="shortcut-placeholder">{placeholder}</span>}
      {listening && <span className="shortcut-listening-hint">按下组合键…</span>}
    </div>
  );
}

function ShortcutKeycaps({ accelerator }: { accelerator: string }) {
  return (
    <KbdGroup aria-label={accelerator} className="shortcut-keycaps">
      {accelerator.split("+").map((part, index) => (
        <Kbd key={`${part}-${index}`}>{formatAcceleratorForDisplay(part)}</Kbd>
      ))}
    </KbdGroup>
  );
}

function isModifierKey(key: string) {
  return ["Shift", "Alt", "Control", "Meta", "AltGraph", "Fn", "FnLock"].includes(key);
}

/// 把 KeyboardEvent 转换为 Tauri Accelerator 字符串。
/// 至少需要一个修饰键，避免单字母绑定被识别为普通输入。
function buildAccelerator(event: KeyboardEvent): string | null {
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  const keyName = mapKeyName(event.key);
  if (!keyName) return null;
  parts.push(keyName);

  return parts.join("+");
}

function mapKeyName(key: string): string | null {
  if (key.length === 1) {
    return key.toUpperCase();
  }
  switch (key) {
    case "Enter":
      return "Return";
    case "Escape":
      return "Escape";
    case "Tab":
      return "Tab";
    case " ":
      return "Space";
    case ",":
      return "Comma";
    case ".":
      return "Period";
    case "/":
      return "Slash";
    case "\\":
      return "Backslash";
    case "-":
      return "Minus";
    case "=":
      return "Equal";
    case "[":
      return "BracketLeft";
    case "]":
      return "BracketRight";
    case ";":
      return "Semicolon";
    case "'":
      return "Quote";
    case "`":
      return "Backquote";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
    case "Delete":
      return "Delete";
    case "Backspace":
      return "Backspace";
    case "Insert":
      return "Insert";
    default:
      if (/^F\d{1,2}$/.test(key)) return key;
      return null;
  }
}

/// 把 Tauri Accelerator 字符串格式化为 macOS 友好的显示文本，例如 "Alt+Shift+O" -> "⌥⇧O"。
export function formatAcceleratorForDisplay(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => {
      const trimmed = part.trim();
      switch (trimmed.toLowerCase()) {
        case "alt":
        case "option":
          return "⌥";
        case "shift":
          return "⇧";
        case "control":
        case "ctrl":
        case "cmdorctrl":
        case "commandorcontrol":
          return "⌃";
        case "super":
        case "meta":
        case "cmd":
        case "command":
        case "win":
          return "⌘";
        case "comma":
          return ",";
        case "period":
          return ".";
        case "slash":
          return "/";
        case "backslash":
          return "\\";
        case "minus":
          return "-";
        case "equal":
          return "=";
        case "space":
          return "Space";
        case "return":
        case "enter":
          return "⏎";
        case "backspace":
          return "⌫";
        case "delete":
          return "⌦";
        case "escape":
          return "⎋";
        case "tab":
          return "⇥";
        case "up":
          return "↑";
        case "down":
          return "↓";
        case "left":
          return "←";
        case "right":
          return "→";
        case "home":
          return "↖";
        case "end":
          return "↘";
        case "pageup":
          return "⇞";
        case "pagedown":
          return "⇟";
        default:
          if (/^F\d{1,2}$/.test(trimmed)) return trimmed;
          return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
      }
    })
    .join("");
}
