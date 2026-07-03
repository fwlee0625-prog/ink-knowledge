type EmptyStateProps = {
  children: string;
  variant?: "inline" | "result";
};

export function EmptyState({ children, variant = "inline" }: EmptyStateProps) {
  return <div className={variant === "result" ? "empty-result" : "empty-state"}>{children}</div>;
}
