import { ToggleGroup, ToggleGroupItem } from "../../ui";

export type SizeOption<TValue extends string> = {
  detail: string;
  label: string;
  value: TValue;
};

type SizeOptionCardsProps<TValue extends string> = {
  disabled?: boolean;
  onChange: (value: TValue) => void;
  options: Array<SizeOption<TValue>>;
  value: TValue;
};

export function SizeOptionCards<TValue extends string>({
  disabled = false,
  onChange,
  options,
  value,
}: SizeOptionCardsProps<TValue>) {
  return (
    <ToggleGroup
      className="grid w-[min(520px,50vw)] grid-cols-3 gap-2 max-lg:w-full"
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (nextValue) onChange(nextValue as TValue);
      }}
      type="single"
      value={value}
    >
      {options.map((option) => (
        <ToggleGroupItem
          aria-label={`${option.label} ${option.detail}`}
          className="h-auto min-h-[76px] min-w-0 flex-col gap-1 rounded-md border border-border/70 bg-muted/45 px-3 py-3 text-muted-foreground shadow-none hover:border-border hover:bg-muted hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground"
          key={option.value}
          value={option.value}
        >
          <strong className="block w-full truncate text-center text-sm font-semibold">{option.label}</strong>
          <span className="block w-full text-center text-xs font-medium leading-4 opacity-80">
            {option.detail}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
