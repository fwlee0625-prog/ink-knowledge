import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type AppButtonVariant = "primary" | "ghost" | "text" | "file";

type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
  variant?: AppButtonVariant;
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  { active = false, children, className = "", variant = "ghost", ...props },
  ref,
) {
  const classes = [buttonClass(variant), active ? "active" : "", className].filter(Boolean).join(" ");

  return (
    <button className={classes} ref={ref} type="button" {...props}>
      {children}
    </button>
  );
});

function buttonClass(variant: AppButtonVariant) {
  if (variant === "primary") return "primary action-button";
  if (variant === "text") return "text-button";
  if (variant === "file") return "file-picker action-button";
  return "ghost action-button";
}
