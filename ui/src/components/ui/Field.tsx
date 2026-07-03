import type { HTMLAttributes, ReactNode } from "react";

type FieldProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  label: string;
};

export function Field({ children, label, ...props }: FieldProps) {
  return (
    <div className="field" {...props}>
      <span>{label}</span>
      {children}
    </div>
  );
}
