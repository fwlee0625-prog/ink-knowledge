import type { ElementType, HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  children: ReactNode;
  variant?: "panel" | "result" | "page" | "status";
};

export function Card({ as: Component = "section", children, className = "", variant = "panel", ...props }: CardProps) {
  const classes = [cardClass(variant), className].filter(Boolean).join(" ");

  return (
    <Component className={classes} {...props}>
      {children}
    </Component>
  );
}

function cardClass(variant: CardProps["variant"]) {
  if (variant === "page") return "page-panel";
  if (variant === "result") return "result";
  if (variant === "status") return "status";
  return "panel";
}
