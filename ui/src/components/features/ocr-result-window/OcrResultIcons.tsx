type IconProps = {
  className?: string;
};

export function PinIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M9 3h6l-.7 5.2 3.2 3.2v2.1h-4.2L12 21l-1.3-7.5H6.5v-2.1l3.2-3.2L9 3Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RefreshIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M5.1 12a6.9 6.9 0 0 1 11.6-5l1.7 1.7V4h2v8h-8v-2h4.3l-1.4-1.4A4.9 4.9 0 1 0 16.8 14h2.1A7 7 0 0 1 5.1 12Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function TranslateIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M4 4h8v2H9.3a10.8 10.8 0 0 1-1.7 4 13.3 13.3 0 0 0 2.4 1.7l-.9 1.8a15 15 0 0 1-2.8-2A14.2 14.2 0 0 1 3 14l-.9-1.8a11.6 11.6 0 0 0 2.9-2.1A8.2 8.2 0 0 1 3.6 8h2.1c.2.3.4.6.7.9A8 8 0 0 0 7.2 6H4V4Zm11.6 6h2.1l4.2 10h-2.2l-.8-2h-4.5l-.8 2h-2.2l4.2-10Zm-.4 6h2.9l-1.5-3.6-1.4 3.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
