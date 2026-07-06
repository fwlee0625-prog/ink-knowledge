type SelectOption<TValue extends string> = {
  label: string;
  value: TValue;
};

type AppSelectProps<TValue extends string> = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: TValue) => void;
  options: SelectOption<TValue>[];
  value: TValue;
};

export function AppSelect<TValue extends string>({
  ariaLabel,
  className,
  disabled = false,
  onChange,
  options,
  value,
}: AppSelectProps<TValue>) {
  const classNames = ["app-select", className].filter(Boolean).join(" ");

  return (
    <label className={classNames}>
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as TValue)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
