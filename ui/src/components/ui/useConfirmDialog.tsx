import { useCallback, useRef, useState } from "react";
import { ConfirmDialog, type ConfirmDialogOptions } from "./ConfirmDialog";

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((nextOptions: ConfirmDialogOptions) => {
    resolverRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(nextOptions);
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
      open={options !== null}
      options={options}
    />
  );

  return { confirm, dialog };
}
