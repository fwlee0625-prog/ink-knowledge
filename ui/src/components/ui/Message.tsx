import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type MessageTone = "success" | "error" | "info" | "warning";

type MessageItem = {
  id: string;
  text: string;
  tone: MessageTone;
};

type MessageOptions = {
  duration?: number;
};

type MessageApi = {
  error: (text: string, options?: MessageOptions) => void;
  info: (text: string, options?: MessageOptions) => void;
  success: (text: string, options?: MessageOptions) => void;
  warning: (text: string, options?: MessageOptions) => void;
};

const MessageContext = createContext<MessageApi | null>(null);

export function MessageProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const seedRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setMessages((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (tone: MessageTone, text: string, options?: MessageOptions) => {
      const id = `${Date.now()}-${seedRef.current}`;
      seedRef.current += 1;
      const duration = options?.duration ?? 1600;

      setMessages((current) => [...current.slice(-2), { id, text, tone }]);

      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const api = useMemo<MessageApi>(
    () => ({
      error: (text, options) => show("error", text, options),
      info: (text, options) => show("info", text, options),
      success: (text, options) => show("success", text, options),
      warning: (text, options) => show("warning", text, options),
    }),
    [show],
  );

  return (
    <MessageContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="message-viewport" role="status">
        {messages.map((item) => (
          <div className={`message-toast ${item.tone}`} key={item.id}>
            <span className="message-toast-icon">{messageIcon(item.tone)}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </MessageContext.Provider>
  );
}

export function useMessage() {
  const api = useContext(MessageContext);
  if (!api) {
    throw new Error("useMessage must be used within MessageProvider.");
  }
  return api;
}

function messageIcon(tone: MessageTone) {
  if (tone === "success") return "✓";
  if (tone === "error") return "!";
  if (tone === "warning") return "!";
  return "i";
}
