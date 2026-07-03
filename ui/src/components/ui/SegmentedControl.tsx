import { AppButton } from "./AppButton";

type SegmentedOption<TValue extends string> = {
  label: string;
  value: TValue;
};

type SegmentedControlProps<TValue extends string> = {
  disabled?: boolean;
  onChange: (value: TValue) => void;
  options: SegmentedOption<TValue>[];
  value: TValue;
};

export function SegmentedControl<TValue extends string>({
  disabled = false,
  onChange,
  options,
  value,
}: SegmentedControlProps<TValue>) {
  return (
    <div className="segmented-control">
      {options.map((option) => (
        <AppButton
          active={value === option.value}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          variant="text"
        >
          {option.label}
        </AppButton>
      ))}
    </div>
  );
}
