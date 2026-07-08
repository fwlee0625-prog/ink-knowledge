import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

type SelectOption<TValue extends string> = {
  disabled?: boolean;
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
  return (
    <Select
      disabled={disabled || options.every((option) => option.disabled)}
      onValueChange={(nextValue) => onChange(nextValue as TValue)}
      value={value}
    >
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue placeholder="未选择" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
