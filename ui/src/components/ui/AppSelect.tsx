import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";

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
  const classNames = ["app-select", className].filter(Boolean).join(" ");
  const selectId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [contentStyle, setContentStyle] = useState<SelectContentStyle>();
  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const enabledIndexes = useMemo(
    () =>
      options
        .map((option, index) => (option.disabled ? -1 : index))
        .filter((index) => index >= 0),
    [options],
  );
  const isDisabled = disabled || enabledIndexes.length === 0;

  useEffect(() => {
    if (open && isDisabled) {
      setOpen(false);
    }
  }, [isDisabled, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const selectedEnabledIndex =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : enabledIndexes[0] ?? 0;
    setActiveIndex(selectedEnabledIndex);
  }, [enabledIndexes, open, options, selectedIndex]);

  const updateContentStyle = () => {
    const trigger = triggerRef.current;

    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportGap = 10;
    const itemHeight = 38;
    const contentHeight = Math.min(280, options.length * itemHeight + 8);
    const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
    const spaceAbove = rect.top - viewportGap;
    const openAbove = spaceBelow < contentHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(120, (openAbove ? spaceAbove : spaceBelow) - 2);
    const maxHeight = Math.min(contentHeight, availableHeight);
    const top = openAbove ? Math.max(viewportGap, rect.top - maxHeight - 6) : rect.bottom + 6;
    const left = Math.min(
      Math.max(viewportGap, rect.left),
      Math.max(viewportGap, window.innerWidth - rect.width - viewportGap),
    );

    setContentStyle({
      left,
      maxHeight,
      minWidth: rect.width,
      top,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updateContentStyle();
  }, [open, options.length]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        triggerRef.current?.contains(target) ||
        document.getElementById(`${selectId}-content`)?.contains(target)
      ) {
        return;
      }

      setOpen(false);
    };
    const handleResize = () => updateContentStyle();
    const handleScroll = () => updateContentStyle();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, selectId, options.length]);

  const selectOption = (nextOption: SelectOption<TValue>) => {
    if (nextOption.disabled) {
      return;
    }

    onChange(nextOption.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActiveIndex = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) {
      return;
    }

    const currentEnabledPosition = enabledIndexes.includes(activeIndex)
      ? enabledIndexes.indexOf(activeIndex)
      : 0;
    const nextPosition =
      (currentEnabledPosition + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (isDisabled) {
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        moveActiveIndex(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        moveActiveIndex(-1);
        return;
      case "Home":
        if (open) {
          event.preventDefault();
          setActiveIndex(enabledIndexes[0] ?? 0);
        }
        return;
      case "End":
        if (open) {
          event.preventDefault();
          setActiveIndex(enabledIndexes[enabledIndexes.length - 1] ?? 0);
        }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (options[activeIndex]) {
          selectOption(options[activeIndex]);
        }
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      default:
        return;
    }
  };

  return (
    <div
      className={classNames}
      data-disabled={isDisabled ? "true" : undefined}
      data-open={open ? "true" : undefined}
    >
      <button
        aria-activedescendant={open ? `${selectId}-option-${activeIndex}` : undefined}
        aria-controls={`${selectId}-content`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="app-select-trigger"
        disabled={isDisabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className="app-select-value">{selectedOption?.label ?? "未选择"}</span>
        <span aria-hidden="true" className="app-select-chevron" />
      </button>
      {open &&
        contentStyle &&
        createPortal(
          <div
            className="app-select-content"
            id={`${selectId}-content`}
            role="listbox"
            style={{
              left: contentStyle.left,
              maxHeight: contentStyle.maxHeight,
              minWidth: contentStyle.minWidth,
              top: contentStyle.top,
            }}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;

              return (
                <div
                  aria-disabled={option.disabled ? "true" : undefined}
                  aria-selected={selected}
                  className="app-select-item"
                  data-active={active ? "true" : undefined}
                  data-disabled={option.disabled ? "true" : undefined}
                  data-selected={selected ? "true" : undefined}
                  id={`${selectId}-option-${index}`}
                  key={option.value}
                  onClick={() => selectOption(option)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setActiveIndex(index);
                    }
                  }}
                  role="option"
                >
                  <span className="app-select-item-label">{option.label}</span>
                  {selected && <span aria-hidden="true" className="app-select-check" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

type SelectContentStyle = {
  left: number;
  maxHeight: number;
  minWidth: number;
  top: number;
};
