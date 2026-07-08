import type { CSSProperties } from "react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

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
  const style = { "--segmented-options": options.length } as CSSProperties;

  return (
    <ToggleGroup
      className="segmented-control"
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onChange(nextValue as TValue);
        }
      }}
      style={style}
      type="single"
      value={value}
    >
      {options.map((option) => (
        <ToggleGroupItem
          className="text-button"
          key={option.value}
          value={option.value}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
