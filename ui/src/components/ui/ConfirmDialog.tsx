import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { cn } from "../../lib/utils";

export type ConfirmDialogOptions = {
  cancelText?: string;
  confirmText?: string;
  description: string;
  title: string;
  tone?: "default" | "warning" | "danger";
};

type ConfirmDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  options: ConfirmDialogOptions | null;
};

export function ConfirmDialog({ onCancel, onConfirm, open, options }: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <AlertDialogContent className="rounded-2xl border-border/60 shadow-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title ?? "确认操作"}</AlertDialogTitle>
          <AlertDialogDescription>{options?.description ?? ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{options?.cancelText ?? "取消"}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              options?.tone === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
            onClick={onConfirm}
          >
            {options?.confirmText ?? "确认"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
